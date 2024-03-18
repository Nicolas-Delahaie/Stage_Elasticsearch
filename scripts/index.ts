import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import { cleaner, requestEmbeddingApi, storeTokenCount } from "utils";

type Langues = "fr" | "es" | "en" | "ge";
export type T_sku = {
  skuGuid: string;
  skuName: Partial<Record<Langues, string>>;
  skuDescription: Partial<Record<Langues, string>>;
  nameEmbedding: number[] | null;
  descriptionEmbedding: number[] | null;
};

export class Initializer extends Client {
  public readonly INDEX_NAME: string = "skus";
  public readonly EMBED_DIMS = 256;
  public readonly SKUS_BULK_LIMIT = 10000; // ce nombre est arbitraire et depend de la taille des donnes (nom, description et surtout dimension embedding)
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

      const skus = await this.putEmbeddings(skusBrut);
      console.log("\u2705 Embeddings fabriqués");

      await this.bulkIndexingApi(skus);
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
  private async putEmbeddings(jsonInput: any[], docsNumber?: number | undefined) {
    // -- Reduction du nombre de produits --
    if (docsNumber) {
      jsonInput.splice(docsNumber);
    }

    //  -- Uniformisation des documents --
    console.log("...Uniformisation des documents");
    const skus = jsonInput.map((sku) => ({
      // Reduction et traitement des attributs
      skuGuid: sku.skuGuid,
      skuDescription: {
        en: sku.skuDescription.en && cleaner(sku.skuDescription.en),
        fr: sku.skuDescription.fr && cleaner(sku.skuDescription.fr, true),
        es: sku.skuDescription.es && cleaner(sku.skuDescription.es),
        ge: sku.skuDescription.ge && cleaner(sku.skuDescription.ge),
      },
      skuName: {
        en: sku.skuName.en && cleaner(sku.skuName.en),
        fr: sku.skuName.fr && cleaner(sku.skuName.fr, true),
        es: sku.skuName.es && cleaner(sku.skuName.es),
        ge: sku.skuName.ge && cleaner(sku.skuName.ge),
      },
    }));

    // -- Creation des embeddings par bulk --
    console.log("...Tentative generation des embeddings");
    const nomClient = jsonInput[0]?.skuChannelNameCollection as string;
    const frDescriptionEmbeddings = await this.bulkEmbeddingApi(
      skus.map((sku) => sku.skuDescription.fr ?? ""),
      nomClient + " : decriptions"
    );
    const frNameEmbeddings = await this.bulkEmbeddingApi(
      skus.map((sku) => sku.skuName.fr ?? ""),
      nomClient + " : titres"
    );

    // -- Recomposition des produits avec leur embedding
    const skusWithEmbeddings: T_sku[] = skus.map((sku, i) => ({
      ...sku,
      nameEmbedding: frNameEmbeddings[i],
      descriptionEmbedding: frDescriptionEmbeddings[i],
    }));

    return skusWithEmbeddings;
  }

  /**
   * Envoie les skus en bdd avec le bulkd d Elastic search
   */
  private async bulkIndexingApi(skus: T_sku[]) {
    console.log("...Tentative de stockage en bdd");

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

  private async bulkEmbeddingApi(texts: string[], type: string) {
    /**@todo valeurs a definir */
    const CHARS_IN_A_TOKEN = 60; // Moyenne de nombre de caracteres par token
    const MAX_TOKENS_PER_SECTION = 8000; // Arrondi de 8191
    const MAX_CHARS_PER_SECTION = MAX_TOKENS_PER_SECTION * CHARS_IN_A_TOKEN;
    const SECTION_RATIO_REDUCTION = 6;

    // Gestion des texts vides (genere une erreur dans l api)
    const emptyTextsIndices = texts
      .map((text, i) => (text === "" ? i : null)) // Remplacement des textes vides par des null
      .filter((indice) => indice !== null) as number[]; // Suppression des null

    texts = texts.filter((text) => text !== "");

    let charCounter = 0;
    let iLastSectionText = 0;
    let lastRequestFailed = false;
    let reductionIncrement = undefined;
    let embeddings: (number[] | null)[] = [];
    while (texts.length !== 0) {
      if (!lastRequestFailed) {
        const textLength = texts[iLastSectionText].length;
        charCounter += textLength;
      }
      const isLastElement = iLastSectionText == texts.length - 1;

      if (lastRequestFailed || isLastElement || charCounter > MAX_CHARS_PER_SECTION) {
        // Tentative de generation d embedding
        const section = texts.slice(0, iLastSectionText + 1);
        const others = texts.slice(iLastSectionText + 1);
        const res = await requestEmbeddingApi(section, this.EMBED_DIMS);
        /**@todo Gerer la sauvegarde des donnees au cas ou ca plante */
        if (res.success) {
          // Stockages embeddings et tokens utilises
          const firstCall = embeddings.length === 0;
          storeTokenCount(res.tokens, firstCall, type);
          embeddings.push(...res.data);

          // Mise a jour des variables
          charCounter = 0;
          iLastSectionText = 0;
          lastRequestFailed = false;
          reductionIncrement = undefined;
          texts = others;
          this.__DEBUG__ && console.log("   \u2705", section.length, "embeddings générés !");
        } else {
          const typeErreur = res.error.type;
          if (typeErreur === "invalid_request_error") {
            // Tant que la section ne peut pas etre envoyee, elle est reduite
            lastRequestFailed = true;
            if (reductionIncrement === undefined) {
              // Premiere erreur
              reductionIncrement = Math.round(iLastSectionText / SECTION_RATIO_REDUCTION);
            }
            iLastSectionText -= reductionIncrement;

            if (iLastSectionText <= 0) {
              throw Error('Erreur "' + res.error.type + '" :' + res.error.message);
            }
            this.__DEBUG__ && console.log("   ...Reduction des donnees envoyees a", iLastSectionText, "(trop grand OpenAI sinon)");
          } else if (typeErreur === "rate_limit_error") {
            throw Error('Erreur "' + res.error.type + '" :' + "Impossible de continuer, nombre de requetes max autorisées par OpenAI atteint");
          } else if (typeErreur === "internal_server_error " || typeErreur === "service_unavailable") {
            throw Error('Erreur "' + res.error.type + '" :' + "Probleme interne d'OpenAI, impossible de générer les embeddings");
          } else {
            throw Error('Erreur "' + res.error.type + '" :' + "Impossible de generer les embeddings OpenAI");
          }
        }
      } else {
        iLastSectionText++;
      }
    }

    // Re insertion des textes vides
    emptyTextsIndices.map((i) => {
      embeddings.splice(i, 0, null);
    });

    return embeddings;
  }
}

const init = new Initializer();
(async () => {
  await init.Initialisation();

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

  const texts = [
    "Essentiel Essentiel Essentiel Essentiel pour préserver son matelas, Essentiel Essentiel Essentiel Essentiel Essentiel l'alèse spécialement adaptée au matelas Essentiel berceau TROLL. Coloris écru.  coton waterproof, intérieur  polyester, bordures avec élastique   Lavable en machine à   ",
    // "Flèche de lit Universelle Troll Nursery. Elle s'adapte à tous les berceaux et lits bébé Troll Nursery (à l'exception des berceaux textile).  Réglable en hauteur. Tube en acier laqué blanc avec pinces crocodile.  A associer au voile universel Troll (même rubrique)",
  ];
})();

// async function test() {
//   let texts = [...Array(180000).fill("Coucou ça va ou quoiiiii ?")];
//   console.log("Resultat : ", (await init.bulkEmbeddingApi(texts, 3, "Enorme bulk pour test", true)).length, " embeddings");
// }
// test();
