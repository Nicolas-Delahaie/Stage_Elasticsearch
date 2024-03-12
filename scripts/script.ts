import fs from "fs";
import { Client } from "@elastic/elasticsearch";
export { embeddings_generation } from "./embeddingss";

type T_sku = {
  skuGuid: string;
  skuName: string;
  skuDescription: string;
};

const RESULTS_SIZE = 100;

class Elasticsearch extends Client {
  public readonly INDEX_NAME: string = "skus";

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
      await this.deleteIndex();
      await this.createIndex();
      await this.indexDocuments(5);
      console.log("Initialisation reussie !");
    } catch (error) {
      console.error(error);
    }
  }
  private async deleteIndex() {
    const existeDeja = await this.indices.exists({
      index: this.INDEX_NAME,
    });

    if (existeDeja) {
      const res = await this.indices.delete({
        index: this.INDEX_NAME,
        ignore_unavailable: true,
      });

      if (!res.acknowledged) {
        throw new Error("Suppression ancien index raté");
      }
    }
  }
  private async createIndex() {
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
            embedding: {
              type: "dense_vector",
              dims: 2,
              index: true,
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
      throw new Error("Création index ratée");
    }
  }
  private cleaner(text: string) {
    const regexPromos =
      /(\* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5)|(- Offre -5%)|(A partir [0-9]+ € D'ACHAT = [0-9]+% DE REMISE-code promo OFFRE[0-9]+)|(Offre de Bienvenue : 5% avec le code promo : PROMO5)|(DERNIÈRE DEMARQUE -10% SUPPLEMENTAIRES.*AVEC LE CODE PROMO : 10)/;
    const regexDimensions = /[0-9]+x[0-9]+( cm)?/;
    const regexBalises = /<[^>]*>/g;
    const regexNombres = /[0-9]+ ?(€|°|%)?/g;
    text = text.replace(regexPromos, "");
    text = text.replace(regexDimensions, "");
    text = text.replace(regexBalises, " ");
    text = text.replace(regexNombres, "");
    return text;
  }
  private async indexDocuments(docsNumber?: number | undefined) {
    const skusFile = fs.readFileSync("exemple_donnees.json", "utf8");
    const skusBrut = JSON.parse(skusFile).skus as any[];
    const skus = skusBrut.map((sku) => ({
      skuGuid: sku.skuGuid,
      skuDescription: {
        ...sku.skuDescription,
        fr: this.cleaner(sku.skuDescription.fr ?? ""),
      },
      skuName: {
        ...sku.skuName,
        fr: this.cleaner(sku.skuName.fr ?? ""),
      },
    }));

    if (docsNumber) {
      skus.splice(docsNumber);
    }

    let operations: any[] = [];
    skus.forEach((sku: T_sku) => {
      operations.push({ create: { _index: this.INDEX_NAME } });
      operations.push(sku);
    });

    const res = await this.bulk({
      refresh: true,
      /**@todo intégrer un analyseur */
      operations: operations,
    });
    console.log(res);

    if (res.errors) {
      throw new Error(
        "Indexation ratée : " +
          res.took +
          " documents indexés sur " +
          skus.length
      );
    }
  }
  private async generateEmbeddings() {}

  // TESTING
  public async testSearch() {
    return await this.search({
      index: this.INDEX_NAME,
      query: {
        bool: {
          must: [
            {
              multi_match: { query: "lit", fields: ["name", "description"] },
            },
          ],
        },
      },
      // aggs: {
      //   "weight-agg": {
      //     range: {
      //       field: "weight",
      //       ranges: [
      //         { from: 0, to: 10 },
      //         { from: 10, to: 20 },
      //         { from: 10, to: 30 },
      //         { from: 10, to: 40 },
      //       ],
      //     },
      //   },
      // },
      size: RESULTS_SIZE,
      from: RESULTS_SIZE * 0,
    });
  }
}

const etk = new Elasticsearch();
(async () => {
  await etk.Initialisation();

  /* Getters */
  // console.log((await client.indices.get({ index: INDEX_NAME }))[INDEX_NAME]);
  // console.log((await client.indices.getMapping()).skus);
  // console.log(
  //   (await etk.indices.getSettings({ index: "_all" }))?.skus?.settings?.index
  // );
  // console.log((await searchSkus()).hits.hits);
  // console.log(
  //   (
  //     await etk.termvectors({
  //       index: etk.INDEX_NAME,
  //       id: "UarZLI4Bq2pXlB88xHEN",
  //       fields: ["description", "name"],
  //     })
  //   ).term_vectors?.description?.terms
  // );

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

  async function embeddingAnalyzer(texts: string[]) {
    const tokensPromises = texts.map(async (text) => {
      const res = await etk.indices.analyze({
        index: etk.INDEX_NAME,
        body: {
          text,
          analyzer: "embedding_analyzer",
        },
      });
      if (!res.tokens) {
        throw new Error("Analyseur d'embedding a écouché");
      }
      const tokens = res.tokens.map((token) => token.token);
      const tokensJoined = tokens.join(" ");
      return tokensJoined;
    });
    return await Promise.all(tokensPromises);
  }

  const texts = [
    "Essentiel pour préserver son matelas, l'alèse spécialement adaptée au matelas berceau TROLL. Coloris écru.  coton waterproof, intérieur  polyester, bordures avec élastique   Lavable en machine à   ",
    "Flèche de lit Universelle Troll Nursery. Elle s'adapte à tous les berceaux et lits bébé Troll Nursery (à l'exception des berceaux textile).  Réglable en hauteur. Tube en acier laqué blanc avec pinces crocodile.  A associer au voile universel Troll (même rubrique)",
  ];

  console.log(await embeddingAnalyzer(texts));
})();
