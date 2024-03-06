import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import { MappingTypeMapping } from "@elastic/elasticsearch/lib/api/types";

type T_sku = {
  id: string;
  name: string;
  description: string;
  weight: number;
};

const INDEX_NAME = "skus";
const RESULTS_SIZE = 1000;

const client = new Client({
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
    ca: fs.readFileSync("../../http_ca.crt"), // Recuperable par "cp es01:/usr/share/elasticsearch/config/certs/http_ca.crt ."
  },
});

const ex_produit: T_sku = {
  id: "ok",
  name: "Kit de conversion Sparrow par Oeuf be good",
  description:
    "<div><b><b>Le kit de convesion Sparrow accompagnera votre enfant du lit bébé au lit junior.</b></b><br></div><div><b><b><br />Il remplace les barreaux sur un des côté du lit.<br><br />Grâce à la hauteur du sommier de 21,5 cm, votre enfant pourra monter et descendre de son lit comme un grand.<br><br />Vous pourrez ainsi le voir évoluer vers l'autonomie sans risque de chute.<br> <br><br /><br />L’ensemble de la gamme Œuf est réputé pour son esthétisme et son élégance.<br><br />Elle assure une qualité et une finition irréprochables dans le respect de l'environnement.<br><br />Cela va du choix de ses matériaux, aux processus de fabrication, mais aussi à la sélection des emballages recyclés.<br><br><br /></b></b></div>",
  weight: 10,
};

// Initialisation
const deleteIndex = async () =>
  await client.indices.delete({
    index: INDEX_NAME,
  });
const createIndex = async () =>
  await client.indices.create({
    index: INDEX_NAME,
    body: {
      mappings: {
        properties: {
          id: { type: "text" },
          name: { type: "text", analyzer: "french" },
          description: {
            type: "text",
            analyzer: "french",
          },

          weight: { type: "float" },
        },
      },
    },
  });

const indexExampleDocument = async () =>
  await client.index({ index: INDEX_NAME, document: ex_produit });

const indexDocuments = async () => {
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
  let operations: any[] = [];
  skus.forEach((sku) => {
    operations.push({ create: { _index: INDEX_NAME } });
    operations.push(sku);
  });

  return await client.bulk({
    refresh: true,
    /**@todo intégrer un analyseur */
    operations: operations,
  });
};

// Getters
const searchSkus = async () =>
  await client.search({
    index: INDEX_NAME,
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

(async () => {
  /* Initialisation */
  // console.log(await deleteIndex());
  // console.log(await createIndex());
  // console.log(await indexDocuments());

  /* Getters */
  // console.log((await client.indices.get({ index: INDEX_NAME }))[INDEX_NAME]);
  // console.log((await client.indices.getMapping()).skus);
  // console.log(
  //   (await client.search({ index: INDEX_NAME, size: 10000 })).hits.hits
  // );
  console.log((await searchSkus()).aggregations?.["weight-agg"]);
})();
