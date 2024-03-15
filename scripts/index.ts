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
  public readonly SKUS_BULK_LIMIT = 1000;
  public readonly __DEBUG__ = true;

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
    const skusFile = fs.readFileSync("exemple_donnees.json", "utf8");
    const skusBrut = JSON.parse(skusFile).skus as any[];

    try {
      await this.createIndex();
      console.log("\u2705 Index initialisé");

      await this.indexSkus(skusBrut);
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
  private async indexSkus(jsonInput: any[], docsNumber?: number | undefined) {
    // -- Reduction du nombre de produits --
    if (docsNumber) {
      jsonInput.splice(docsNumber);
    }

    //  -- Uniformisation des documents --
    console.log("...Uniformisation des documents");
    const skus: T_sku[] = jsonInput.map((sku) => ({
      /**@todo gerer l ingeration d une autre langue s il n y a pas de francais */
      /**@todo gerer le flatening des autres langues */
      skuGuid: sku.skuGuid,
      skuDescription: {
        en: sku.skuDescription.en && cleaner(sku.skuDescription.en),
        fr: sku.skuDescription.fr && cleaner(sku.skuDescription.fr),
        es: sku.skuDescription.es && cleaner(sku.skuDescription.es),
        ge: sku.skuDescription.ge && cleaner(sku.skuDescription.ge),
      },
      skuName: {
        en: sku.skuName.en && cleaner(sku.skuName.en),
        fr: sku.skuName.fr && cleaner(sku.skuName.fr),
        es: sku.skuName.es && cleaner(sku.skuName.es),
        ge: sku.skuName.ge && cleaner(sku.skuName.ge),
      },
    }));

    // -- Creation des embeddings par bulk --
    console.log("...Generation des embeddings");
    const nomClient = jsonInput[0]?.skuChannelNameCollection as string;
    const frDescriptionEmbeddings = await bulkEmbeddingApi(
      skus.map((sku) => sku.skuDescription.fr ?? ""),
      this.EMBED_DIMS,
      nomClient + " : decriptions",
      this.__DEBUG__
    );
    const frNameEmbeddings = await bulkEmbeddingApi(
      skus.map((sku) => sku.skuName.fr ?? ""),
      this.EMBED_DIMS,
      nomClient + " : titres",
      this.__DEBUG__
    );

    // -- Recomposition des produits avec leur embedding
    const skusWithEmbeddings: T_sku[] = skus.map((sku, i) => ({
      ...sku,
      nameEmbedding: frNameEmbeddings[i],
      descriptionEmbedding: frDescriptionEmbeddings[i],
    }));

    // -- Indexation --
    console.log("...Tentative de stockage en bdd");
    await this.bulkIndexingApi(skusWithEmbeddings);
  }

  /**
   * Envoie les skus en bdd avec le bulkd d Elastic search
   */
  private async bulkIndexingApi(skus: T_sku[]) {
    /**@todo gerer l ingeratin d une autre langue s il n y a pas de francais */
    /**@todo gerer le flatening des autres langues */
    const nbEnvois = Math.ceil(skus.length / this.SKUS_BULK_LIMIT);
    for (let iEnvoi = 0; iEnvoi < nbEnvois; iEnvoi++) {
      const skuNumber =
        iEnvoi === nbEnvois - 1
          ? skus.length % this.SKUS_BULK_LIMIT // Dernier element
          : this.SKUS_BULK_LIMIT;

      let operations = [];
      for (let i = 0; i < skuNumber; i++) {
        const iSku = iEnvoi * this.SKUS_BULK_LIMIT + i;
        const sku = skus[iSku];
        operations.push({ create: { _index: this.INDEX_NAME } });
        operations.push(sku);
      }

      const res = await this.bulk({
        refresh: true,
        operations: operations,
      });

      // -- Analyse du resultat --
      if (res.errors) {
        throw Error("indexation ratée : " + res.took + " documents indexés sur " + skus.length);
      } else {
        this.__DEBUG__ && console.log("   \u2705", skuNumber, "produits enregistrés en bdd");
      }
    }
  }
}

const els = new Elasticsearch();
(async () => {
  await els.Initialisation();

  // flattening(
  //   " J'éspère qu'il est fort Le kit de conversion Sparrowlit accompagnera votre enfant du litlit bébé lit au lit junior. Il remplace les lit barreaux sur un lit des côté lit du lit lit. litGrâce lit à lit la lit hauteur du sommier de ,cm, votre enfant pourra monter et descendre de son lit comme un grand. Vous pourrez ainsi le voir évoluer vers l'autonomie sans risque de chute. L’ensemble de la gamme Œuf est réputé pour son esthétisme et son élégance. Elle assure une qualité et une finition irréprochables dans le respect de l'environnement. Cela va du choix de ses matériaux, aux processus de fabrication, mais aussi à la sélection des emballages lit lit lit lit lit lit lit recyclés."
  // );

  // const queryEmbedding = (await bulkEmbeddingApi(["matela bebe"], els.EMBED_DIMS))[0];

  // if (queryEmbedding) {
  //   console.log(
  //     (
  //       await els.search({
  //         knn: {
  //           field: "descriptionEmbedding",
  //           k: 3,
  //           num_candidates: 1000,
  //           query_vector: queryEmbedding,
  //           boost: 1,
  //         },
  //       })
  //     ).hits.hits[0]
  //   );
  // }

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
