import fs from "fs";
import { Client } from "@elastic/elasticsearch";

type T_sku = {
  id: string;
  name: string;
  description: string;
  weight: number;
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
      // await this.createAnalyzer();
      await this.createIndex();
      await this.indexDocuments();
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
  private async createAnalyzer() {
    const res = await this.indices.create({
      index: this.INDEX_NAME,
      settings: {
        analysis: {
          char_filter: {
            cleaner: {
              type: "pattern_replace",
              pattern:
                "(\\* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5)|\
                  (- Offre -5%)|\
                  (A partir [0-9]+ € D'ACHAT = [0-9]+% DE REMISE-code promo OFFRE[0-9]+)|\
                  (Offre de Bienvenue : 5% avec le code promo : PROMO5)|\
                  (DERNIÈRE DEMARQUE -10% SUPPLEMENTAIRES.*AVEC LE CODE PROMO : 10)",
              replacement: "",
            },
          },
          analyzer: {
            french_analyzer: {
              type: "custom",
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding"],
              char_filter: ["html_strip", "cleaner"],
            },
          },
        },
      },
    });
  }
  private async createIndex() {
    const res = await this.indices.create({
      index: this.INDEX_NAME,
      body: {
        mappings: {
          properties: {
            id: { type: "text" },
            name: { type: "text", analyzer: "french" },
            description: {
              type: "text",
              analyzer: "french",
            },
            embedding: {
              type: "dense_vector",
              dims: 2,
              index: true,
            },
            weight: { type: "float" },
          },
        },
      },
    });

    if (!res.acknowledged) {
      throw new Error("Création index ratée");
    }
  }
  private async indexDocuments(docsNumber?: number | undefined) {
    const skusFile = fs.readFileSync("exemple_donnees.json", "utf8");
    const skusBrut = JSON.parse(skusFile).skus as any[];
    const skus = skusBrut.map((sku) => {
      const formatedSku: T_sku = {
        id: sku.skuGuid,
        name: sku.skuName.fr ?? "" /**@todo Langue à gérer */,
        description: sku.skuDescription.fr ?? "" /**@todo Langue à gérer */,
        weight: sku.skuWeight,
      };
      return formatedSku;
    });

    if (docsNumber) {
      skus.splice(docsNumber);
    }

    let operations: any[] = [];
    skus.forEach((sku) => {
      operations.push({ create: { _index: this.INDEX_NAME } });
      operations.push(sku);
    });

    const res = await this.bulk({
      refresh: true,
      /**@todo intégrer un analyseur */
      operations: operations,
    });

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
  //   await etk.indices.analyze({
  //     // index: etk.INDEX_NAME,
  //     body: {
  //       text: '<p class="p1"><span style="font-size: 11.8181819915771px;"><br></span></p><p class="p1"><span style="font-size: 11.8181819915771px;">Le lit junior Leander a été primé à de nombreuses reprises pour son design astucieux et fonctionnel.<br>Tout en rondeur, le designer Stig Leander Nielsen utilise la technique scandinave du bois cintré pour créer une forme de mobilier "organique" qui se veut chaleureuse et rassurante.</span><br></p><p class="p1">Le matelas inclus, est en mousse haute résilience, coutil en laine thermo ouatinée traité écotex. La couverture du matelas a suivi un processus hypo-allergénique, elle est lavable à 60°C.&nbsp;</p><p class="p1"><span style="font-size: 11.8181819915771px;">Il accueille votre enfant&nbsp;</span><span style="font-size: 11.8181819915771px;">jusqu\'à l\'âge de 8 ans</span><span style="font-size: 11.8181819915771px;">.</span><br></p><p class="p1"><span style="font-size: 11.8181819915771px;">La barrière de sécurité qui s\'adapte parfaitement au lit junior (70x150 cm) est vendue séparément rubrique: Accessoires lit enfant.</span></p><p class="p1"><br><br></p>',
  //       analyzer: "french_analyzer",
  //     },
  //   })
  // );
})();
