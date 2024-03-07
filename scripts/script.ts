import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import { MappingTypeMapping } from "@elastic/elasticsearch/lib/api/types";

type T_sku = {
  id: string;
  name: string;
  description: string;
  weight: number;
};

const RESULTS_SIZE = 5;

class Elasticsearch {
  private client: Client;
  private readonly INDEX_NAME: string = "skus";

  constructor() {
    this.client = new Client({
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

  public async Initialisation(): Promise<boolean> {
    const initOk =
      (await this.deleteIndex()) &&
      (await this.createIndex()) &&
      (await this.indexDocuments(5));

    console.log(
      initOk ? "Initialisation reussie !" : "Initialisation ratée..."
    );

    return initOk;
  }
  private async deleteIndex(): Promise<boolean> {
    const existeDeja = await this.client.indices.exists({
      index: this.INDEX_NAME,
    });

    if (existeDeja) {
      const res = await this.client.indices.delete({
        index: this.INDEX_NAME,
        ignore_unavailable: true,
      });

      if (!res.acknowledged) {
        console.log(res);
      }
      return res.acknowledged;
    } else {
      return true;
    }
  }
  private async createIndex(): Promise<boolean> {
    const res = await this.client.indices.create({
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
      console.log(res);
    }
    return res.acknowledged;
  }
  private async indexDocuments(
    docsNumber: number | undefined
  ): Promise<boolean> {
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

    const res = await this.client.bulk({
      refresh: true,
      /**@todo intégrer un analyseur */
      operations: operations,
    });

    if (res.errors) {
      console.log(res);
    }
    return !res.errors;
  }

  // TESTING
  public async testSearch() {
    return await this.client.search({
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
etk.Initialisation();
(async () => {
  /* Getters */
  // console.log((await client.indices.get({ index: INDEX_NAME }))[INDEX_NAME]);
  // console.log((await client.indices.getMapping()).skus);
  // console.log(
  //   (await client.search({ index: INDEX_NAME, size: 10000 })).hits.hits
  // );
  // console.log((await searchSkus()).hits.hits);
})();
