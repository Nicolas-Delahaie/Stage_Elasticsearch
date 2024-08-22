import fs from "fs";
import { Client, errors } from "@elastic/elasticsearch";
import { cleaner, combineEmbeddings, normalizeEmbedding, requestEmbeddingApi, storeInResultFile, storeTokenCount } from "./utils";
import { fileSystem } from "@tensorflow/tfjs-node/dist/io";

type Langues = "fr" | "es" | "en" | "ge";
export type T_sku = {
  skuGuid: string;
  skuName: Partial<Record<Langues, string>>;
  skuDescription: Partial<Record<Langues, string>>;
  embedding: number[] | null;
};

export class Initializer extends Client {
  public readonly __DEBUG__ = true;
  public readonly EMBEDDINGS_WEIGHTS = {
    name: 1,
    description: 3,
  };
  public readonly INDEX_NAME: string = "skus";
  public readonly EMBED_DIMS = 1536;
  public readonly SKUS_BULK_LIMIT = 10000; // ce nombre est arbitraire et depend de la taille des donnes (nom, description et surtout dimension embedding) : fonctionne aussi a 15000

  constructor() {
    let config;
    try {
      config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
    } catch (e) {
      throw Error("Impossible de lire le fichier de configuration (config.json)");
    }

    if (!config.elsusername) throw Error("Impossible de trouver le username elastic");
    if (!config.elspassword) throw Error("Impossible de trouver le mot de passe elastic");

    super({
      node: "https://localhost:9200", // Elasticsearch endpoint
      auth: {
        // apiKey: {
        //   // Cle generee pour javascript
        //   id: "script_javascript",
        //   api_key: "TTIyckRvNEI2bWtNNnItdmhuOFg6M01CSnVwSl9SbUdIXy1rSXhDalhFQQ==",
        // },
        username: config.elsusername,
        password: config.elspassword,
      },
      tls: {
        // ca: fs.readFileSync("http_ca.crt"), // Recuperable par "cp es01:/usr/share/elasticsearch/config/certs/http_ca.crt ."
        rejectUnauthorized: false,
      },
    });
  }

  public async Initialization() {
    try {
      const nomClient = "babyroom";

      // await this.createIndex();
      // console.log("\u2705 Index initialisé");

      console.log("...Importation fichier JSON");
      const skusFile = fs.readFileSync("skus/" + nomClient + ".json", "utf8");
      const brutSkus = JSON.parse(skusFile) as any[];
      console.log("\u2705 Fichier JSON importé (" + brutSkus.length + " produits)");

      await this.createIndex();
      console.log("\u2705 Index initialisé");

      const cleanedSkus = this.skusCleaning(brutSkus);
      console.log("\u2705 Nettoyage des attributs effectué");

      const embeddedSkus = await this.putEmbeddings(cleanedSkus, nomClient);
      console.log("\u2705 Embeddings fabriqués");

      await this.bulkIndexingApi(embeddedSkus);
      console.log("\u2705 Indexation reussie");
    } catch (error) {
      console.error("\u274C Initialisation ratée. Plus d'informations dans results/logs.txt");
      storeInResultFile(error, "logs.txt");
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
            embedding: {
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

  private skusCleaning(jsonInput: any[], docsNumber?: number) {
    if (!jsonInput) {
      throw Error("jsonInput n'est pas defini");
    }
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
    })) as T_sku[];
    return skus;
  }

  private async putEmbeddings(skus: T_sku[], clientName: string) {
    // -- Creation des embeddings par bulk --
    console.log("...Tentative generation des embeddings");
    this.__DEBUG__ && console.log("   ...Génération des embeddings de description non nulles");
    const frDescriptionEmbeddings = await this.bulkEmbeddingApi(
      skus.map((sku) => sku.skuDescription.fr ?? ""),
      clientName ?? "Client inconnu" + " : decriptions"
    );
    this.__DEBUG__ && console.log("   ...Génération des embeddings de titre non nuls");
    const frNameEmbeddings = await this.bulkEmbeddingApi(
      skus.map((sku) => sku.skuName.fr ?? ""),
      clientName ?? "Client inconnu" + " : titres"
    );

    // -- Traitement des embeddings --
    this.__DEBUG__ && console.log("   ...Traitement des embeddings");
    const embeddings: (number[] | null)[] = [];
    for (let i = 0; i < frDescriptionEmbeddings.length; i++) {
      const emb1 = frDescriptionEmbeddings[i];
      const emb2 = frNameEmbeddings[i];
      let newEmbedding;
      if (emb1 !== null && emb2 !== null) {
        const fusion = combineEmbeddings(emb1, emb2, this.EMBEDDINGS_WEIGHTS.description, this.EMBEDDINGS_WEIGHTS.name);
        const normalizedEmbeddings = normalizeEmbedding(fusion);
        newEmbedding = normalizedEmbeddings;
      } else if (emb1 !== null) {
        newEmbedding = emb1;
      } else if (emb2 !== null) {
        newEmbedding = emb2;
      } else {
        newEmbedding = null;
      }
      embeddings[i] = newEmbedding;
    }
    this.__DEBUG__ && console.log("   \u2705 Embeddings pondérés et normalisés avec succès");

    // -- Recomposition des produits avec leur embedding
    return skus.map((sku, i) => ({
      ...sku,
      embedding: embeddings[i],
    })) as T_sku[];
  }

  /**
   * Envoie les skus en bdd avec le bulkd d Elastic search
   */
  public async bulkIndexingApi(skus: T_sku[]) {
    console.log("...Tentative de stockage en bdd");

    const totalSkus = skus.length;
    const packageNumber = Math.ceil(totalSkus / this.SKUS_BULK_LIMIT);
    for (let iPackage = 0; iPackage < packageNumber; iPackage++) {
      const skuNumber =
        iPackage === packageNumber - 1
          ? totalSkus % this.SKUS_BULK_LIMIT // Dernier element
          : this.SKUS_BULK_LIMIT;

      let operations = [];
      for (let i = 0; i < skuNumber; i++) {
        const iSku = iPackage * this.SKUS_BULK_LIMIT + i;
        const sku = skus[iSku];
        operations.push({ create: { _index: this.INDEX_NAME } });
        operations.push(sku);
      }

      let res;
      try {
        res = await this.bulk({
          refresh: true,
          operations: operations,
        });
      } catch (e) {
        // Stockage des skus restants a envoyer
        const remainingSkus = skus.slice(iPackage * this.SKUS_BULK_LIMIT);
        storeInResultFile(remainingSkus, "remainingSkus.json");

        let errorMsg: string;
        if (e instanceof errors.ResponseError && e.statusCode === 413) {
          errorMsg = "trop grosse quantité de données, réduire SKUS_BULK_LIMIT ou augmenter http.max_content_length. ";
        } else {
          errorMsg = "indexation ratée : probleme inconnu. ";
        }
        errorMsg += "Skus restants stockés dans results/remainingSkus.json. Re lancez bulkIndexingApi() avec ces données.";
        throw new Error(errorMsg);
      }

      // -- Analyse du resultat --
      if (res.errors) {
        throw Error("indexation ratée : " + res.took + " documents indexés sur " + skus.length);
      } else {
        this.__DEBUG__ && console.log("   \u2705", skuNumber, "produits enregistrés en bdd");
      }
    }
  }

  public async bulkEmbeddingApi(texts: string[], type: string) {
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
          this.__DEBUG__ && console.log("   \u2705", section.length, "embeddings générés");
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
            this.__DEBUG__ && console.log("      ...Reduction des donnees envoyees a", iLastSectionText, "(trop grand OpenAI sinon)");
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

  // const skus = JSON.parse(readFileSync("remainingSkus.json", "utf8"));
  // console.log(await init.bulkIndexingApi(skus));

  // flattening(
  //   " J'éspère qu'il est fort Le kit de conversion Sparrowlit accompagnera votre enfant du litlit bébé lit au lit junior. Il remplace les lit barreaux sur un lit des côté lit du lit lit. litGrâce lit à lit la lit hauteur du sommier de ,cm, votre enfant pourra monter et descendre de son lit comme un grand. Vous pourrez ainsi le voir évoluer vers l'autonomie sans risque de chute. L’ensemble de la gamme Œuf est réputé pour son esthétisme et son élégance. Elle assure une qualité et une finition irréprochables dans le respect de l'environnement. Cela va du choix de ses matériaux, aux processus de fabrication, mais aussi à la sélection des emballages lit lit lit lit lit lit lit recyclés."
  // );

  const categorie = null;
  const queryEmbedding = (await init.bulkEmbeddingApi(["50cm de diametre"], "test recherche"))!;
  // Sauvegarde de l'embedding dans un fichier temporaire
  fs.writeFileSync("embeddings.json", JSON.stringify(queryEmbedding[0]));

  // const res = await init.search({
  //   knn: {
  //     field: "embedding",
  //     k: 5,
  //     num_candidates: 2000,
  //     query_vector: queryEmbedding[0]!,
  //     boost: 1,
  //   },
  // });

  // const res = await init.search({
  //   query: {
  //     bool: {
  //       // must: categorie ? [{ match: { categorie } }] : undefined,
  //       should: [
  //         {
  //           match: {

  //             "skuName.fr": {
  //               query: input,
  //               boost: 3, // Poids plus élevé pour le titre
  //             },
  //           },
  //         },
  //         {
  //           match: {
  //             "skuDescription.fr": {
  //               query: input,
  //               boost: 1, // Poids standard pour la description
  //             },
  //           },
  //         },
  //       ],
  //       minimum_should_match: 1,
  //     },
  //   },
  //   knn: {
  //     field: "embedding",
  //     k: 10,
  //     query_vector: queryEmbedding,
  //     num_candidates: 500,
  //   },
  //   rank: {
  //     rrf: {
  //       window_size: 50,
  //       rank_constant: 20,
  //     },
  //   },
  // });
  // const res2 = res.hits.hits.map((hit) => hit._source);
  // const scores = res.hits.hits.map((hit) => hit._score);

  // const res3 = res2.map((sku) => {
  //   if (
  //     sku !== null &&
  //     typeof sku === "object" &&
  //     "skuGuid" in sku &&
  //     "skuDescription" in sku &&
  //     sku.skuDescription !== null &&
  //     typeof sku.skuDescription === "object" &&
  //     "fr" in sku.skuDescription &&
  //     "skuName" in sku &&
  //     sku.skuName !== null &&
  //     typeof sku.skuName === "object" &&
  //     "fr" in sku.skuName
  //   ) {
  //     return {
  //       guid: sku.skuGuid,
  //       skuDescription: sku.skuDescription.fr,
  //       skuName: sku.skuName.fr,
  //     };
  //   }
  // });
  // console.log(res);
  // console.log(scores);
  // console.log(res3);
})();
