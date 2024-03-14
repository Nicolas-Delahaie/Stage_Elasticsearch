import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import { bulkEmbeddingApi } from "./bulkEmbeddingApi";
import { cleaner } from "./cleaner";

type Langues = "fr" | "es" | "en" | "ge";
export type T_sku = {
  skuGuid: string;
  skuName: Partial<Record<Langues, string>>;
  skuDescription: Partial<Record<Langues, string>>;
  nameEmbedding?: number[];
  descriptionEmbedding?: number[];
};

export class Elasticsearch extends Client {
  public readonly INDEX_NAME: string = "skus";
  public readonly EMBED_DIMS = 256 * 6;
  public readonly __DEBUG__ = true

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
      console.log("\u2705 Création index");
      await this.indexSkus();
      console.log("\u2705 Indexation reussie");
    } catch (error) {
      console.error("\u274C Initialisation ratée :");
      throw error;
    }
  }
  private async createIndex() {
    // Suppression ancien index
    console.log("...Suppression de l'index");
    const existeDeja = await this.indices.exists({
      index: this.INDEX_NAME,
    });

    if (existeDeja) {
      const res = await this.indices.delete({
        index: this.INDEX_NAME,
        ignore_unavailable: true,
      });

      if (!res.acknowledged) {
        throw Error("suppression ancien index raté");
      }
    }

    // Creation
    console.log("...Création de l'index");
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
      },
    });

    if (!res.acknowledged) {
      throw Error("création index ratée");
    }
  }
  private async indexSkus(docsNumber?: number | undefined) {
    const skusFile = fs.readFileSync("exemple_donnees.json", "utf8");
    const skusBrut = JSON.parse(skusFile).skus as any[];

    // -- Reduction du nombre de produits --
    if (docsNumber) {
      skusBrut.splice(docsNumber);
    }

    //  -- Uniformisation des documents --
    console.log("...Uniformisation des documents");
    let skus = skusBrut.map((sku) => ({
      /**@todo gerer l ingeratin d une autre langue s il n y a pas de francais */
      /**@todo gerer le flatening des autres langues */
      skuGuid: sku.skuGuid,
      skuDescription: {
        ...sku.skuDescription,
        fr: cleaner(sku.skuDescription.fr ?? ""),
      },
      skuName: {
        ...sku.skuName,
        fr: cleaner(sku.skuName.fr ?? ""),
      },
    }));

    // -- Creation des embeddings par bulk --
    console.log("...Generation des embeddings");
    const frDescriptionEmbeddings = await bulkEmbeddingApi(
      skus.map((sku) => sku.skuDescription.fr),
      this.EMBED_DIMS,
      this.__DEBUG__
    );
    const frNameEmbeddings = await bulkEmbeddingApi(
      skus.map((sku) => sku.skuName.fr),
      this.EMBED_DIMS,
      this.__DEBUG__
    );

    // -- Indexation --
    console.log("...Indexation des documents");
    let operations: any[] = [];
    skus.forEach((sku: T_sku, i) => {
      operations.push({ create: { _index: this.INDEX_NAME } });
      operations.push({
        ...sku,
        nameEmbedding: frNameEmbeddings[i],
        descriptionEmbedding: frDescriptionEmbeddings[i],
      });
    });
    const res = await this.bulk({
      refresh: true,
      operations: operations,
    });

    // -- Analyse du resultat --
    if (res.errors) {
      throw Error("indexation ratée : " + res.took + " documents indexés sur " + skus.length);
    }
  }
}

const els = new Elasticsearch();
(async () => {
  await els.Initialisation();

  // flattening(
  //   " J'éspère qu'il est fort Le kit de conversion Sparrowlit accompagnera votre enfant du litlit bébé lit au lit junior. Il remplace les lit barreaux sur un lit des côté lit du lit lit. litGrâce lit à lit la lit hauteur du sommier de ,cm, votre enfant pourra monter et descendre de son lit comme un grand. Vous pourrez ainsi le voir évoluer vers l'autonomie sans risque de chute. L’ensemble de la gamme Œuf est réputé pour son esthétisme et son élégance. Elle assure une qualité et une finition irréprochables dans le respect de l'environnement. Cela va du choix de ses matériaux, aux processus de fabrication, mais aussi à la sélection des emballages lit lit lit lit lit lit lit recyclés."
  // );

  // const queryEmbedding = (
  //   await embeddingApi(["habillement"], els.EMBED_DIMS)
  // )[0];

  // console.log(
  //   (
  //     await els.search({
  //       knn: {
  //         field: "descriptionEmbedding",
  //         k: 3,
  //         num_candidates: 1000,
  //         query_vector: queryEmbedding,
  //         boost: 1,
  //       },
  //     })
  //   ).hits.hits[0]
  // );

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
