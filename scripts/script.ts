import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import { embeddingApi } from "./embeddingss";
import { cleaner } from "./cleaner";
const stopwords = require("stopwords-fr");

type Langues = "fr" | "es" | "en" | "ge";
export type T_sku = {
  skuGuid: string;
  skuName: Partial<Record<Langues, string>>;
  skuDescription: Partial<Record<Langues, string>>;
  nameEmbedding?: number[];
  descriptionEmbedding?: number[];
};

class Elasticsearch extends Client {
  public readonly INDEX_NAME: string = "skus";
  public readonly EMBED_DIMS = 256 * 6;

  constructor() {
    super({
      node: "https://localhost:9200", // Elasticsearch endpoint
      auth: {
        // apiKey: {
        //   // Cle generee pour javascript
        //   id: "script_javascript",
        //   api_key: "TTIyckRvNEI2bWtNNnItdmhuOFg6M01CSnVwSl9SbUdIXy1rSXhDalhFQQ==",
        // },
        username: "elastic",
        password: "elastic",
      },
      tls: {
        ca: fs.readFileSync("http_ca.crt"), // Recuperable par "cp es01:/usr/share/elasticsearch/config/certs/http_ca.crt ."
      },
    });
  }

  public async Initialisation() {
    try {
      await this.createIndex();
      await this.indexDocuments(200);

      console.log("Initialisation reussie !");
    } catch (error) {
      console.error(error);
    }
  }
  private async createIndex() {
    // Suppression ancien index
    const existeDeja = await this.indices.exists({
      index: this.INDEX_NAME,
    });

    if (existeDeja) {
      const res = await this.indices.delete({
        index: this.INDEX_NAME,
        ignore_unavailable: true,
      });

      if (!res.acknowledged) {
        throw Error("Suppression ancien index raté");
      }
    }

    // Creation
    const res = await this.indices.create({
      index: this.INDEX_NAME,
      body: {
        mappings: {
          properties: {
            skuGuid: { type: "text" },
            skuName: {
              properties: {
                fr: { type: "text", analyzer: "french" },
                en: { type: "text", analyzer: "english" },
                es: { type: "text", analyzer: "spanish" },
                ge: { type: "text", analyzer: "german" },
              },
            },
            skuDescription: {
              properties: {
                fr: { type: "text", analyzer: "french" },
                en: { type: "text", analyzer: "english" },
                es: { type: "text", analyzer: "spanish" },
                ge: { type: "text", analyzer: "german" },
              },
            },
            nameEmbedding: {
              type: "dense_vector",
              dims: this.EMBED_DIMS,
              similarity: "cosine", // Le vecteur est normalise donc la similarite cosinus suffit (pas besoins de normaliser la magnitude)
            },
            descriptionEmbedding: {
              type: "dense_vector",
              dims: this.EMBED_DIMS,
              similarity: "cosine", // Le vecteur est normalise donc la similarite cosinus suffit (pas besoins de normaliser la magnitude)
            },
          },
        },
        settings: {
          analysis: {
            analyzer: {
              embedding_analyzer: {
                type: "custom",
                tokenizer: "standard",
                filter: [
                  "french_stop_words",
                  "asciifolding",
                  "remove_duplicates",
                  "lowercase",
                  "elision",
                ],
              },
            },
            filter: {
              french_stop_words: {
                type: "stop",
                ignore_case: true,
                stopwords: ["_french_"],
              },
            },
          },
        },
      },
    });

    if (!res.acknowledged) {
      throw Error("Création index ratée");
    }
  }
  private async indexDocuments(docsNumber?: number | undefined) {
    const skusFile = fs.readFileSync("exemple_donnees.json", "utf8");
    const skusBrut = JSON.parse(skusFile).skus as any[];

    // Troncature
    if (docsNumber) {
      skusBrut.splice(docsNumber);
    }

    // Regex pour filter mauvais caracteres
    let skus = cleaner(skusBrut);

    // Creation des phrases nettoyees pour faire les embeddings
    const flattenedNames = await Promise.all(
      skus.map(async (sku) => await this.flattening(sku.skuName.fr))
    );
    const flattenedDescriptions = await Promise.all(
      skus.map(async (sku) => await this.flattening(sku.skuDescription.fr))
    );

    // Creation des embeddings
    const nameEmbeddings = await embeddingApi(flattenedNames, this.EMBED_DIMS);
    const descriptionEmbeddings = await embeddingApi(
      flattenedDescriptions,
      this.EMBED_DIMS
    );

    // Formattage du body
    let operations: any[] = [];
    skus.forEach((sku: T_sku, i) => {
      operations.push({ create: { _index: this.INDEX_NAME } });
      operations.push({
        ...sku,
        nameEmbedding: nameEmbeddings[i],
        descriptionEmbedding: descriptionEmbeddings[i],
      });
    });

    // Envoi de la requete
    const res = await this.bulk({
      refresh: true,
      operations: operations,
    });

    // Analyse du resultat
    if (res.errors) {
      throw Error(
        "Indexation ratée : " +
          res.took +
          " documents indexés sur " +
          skus.length
      );
    }
  }
  public async flattening(text: string) {
    // Envoi
    const res = await etk.indices.analyze({
      index: etk.INDEX_NAME,
      body: {
        text,
        analyzer: "embedding_analyzer",
      },
    });

    // Analyse
    if (!res.tokens) {
      throw Error("Analyseur d'embedding a écouché");
    }

    // Formattage
    const tokens = res.tokens.map((token) => token.token);
    const tokensJoined = tokens.join(" ");

    return tokensJoined;
  }
}

const etk = new Elasticsearch();
(async () => {
  await etk.Initialisation();

  const queryEmbedding = (
    await embeddingApi(["table solide"], etk.EMBED_DIMS)
  )[0];
  console.log(
    (
      await etk.search({
        knn: {
          field: "descriptionEmbedding",
          k: 3,
          num_candidates: 1000,
          query_vector: queryEmbedding,
          boost: 1,
        },
      })
    ).hits.hits[0]
  );

  // console.log(
  //   (await etk.indices.getSettings({ index: "_all" }))?.skus.settings?.index
  //     ?.analysis?.analyzer
  // );

  // console.log((await client.indices.get({ index: INDEX_NAME }))[INDEX_NAME]);

  // console.log(
  //   (
  //     await etk.indices.analyze({
  //       index: etk.INDEX_NAME,
  //       body: {
  //         text: [
  //           "Joli voile  % coton aufinitions soignées. Il s'adapte à tous les berceaux et lits bébé Troll Nursery.Lavable en machine à °.Se fixe à la flèche de lit présentée dans la même rubrique.",
  //           "Essentiel pour préserver son matelas, l'alèse spécialement adaptée au matelas berceau TROLL.Coloris écru. % coton waterproof, intérieur  % polyester, bordures avec élastique  Lavable en machine à",
  //         ],
  //         analyzer: "embedding_analyzer",
  //       },
  //     })
  //   ).tokens?.map((token) => token.token)
  // );

  const texts = [
    "Essentiel Essentiel Essentiel Essentiel pour préserver son matelas, Essentiel Essentiel Essentiel Essentiel Essentiel l'alèse spécialement adaptée au matelas Essentiel berceau TROLL. Coloris écru.  coton waterproof, intérieur  polyester, bordures avec élastique   Lavable en machine à   ",
    // "Flèche de lit Universelle Troll Nursery. Elle s'adapte à tous les berceaux et lits bébé Troll Nursery (à l'exception des berceaux textile).  Réglable en hauteur. Tube en acier laqué blanc avec pinces crocodile.  A associer au voile universel Troll (même rubrique)",
  ];

  // console.log(await etk.stringAnalyzerForEmbedding(texts));
})();
