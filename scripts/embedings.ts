// npm install node-gyp
// npm install @tensorflow/tfjs-node

// Charger un modèle pré-entraîné, par exemple Universal Sentence Encoder
// import * as tf from "@tensorflow/tfjs-node";
import * as use from "@tensorflow-models/universal-sentence-encoder";

async function getEmbeddings(text: string) {
  const model = await use.load();
  const embeddings = await model.embed([text]);
  embeddings.print(); // Affiche les embeddings dans la console
}

// Générer des embeddings pour un exemple de texte
getEmbeddings("Hello, world!");

// async function query(body: any) {
//   const response = await fetch(
//     "https://api-inference.huggingface.co/models/sentence-transformers/msmarco-MiniLM-L-12-v3",
//     {
//       headers: {
//         Authorization: "Bearer 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",
//       },
//       method: "POST",
//       body: JSON.stringify(body),
//     }
//   );
//   const result = await response.json();
//   return result;
// }

// // query({
// //   inputs: {
// //     source_sentence: "That is a happy person",
// //     sentences: [
// //       "That is a happy dog",
// //       "That is a very happy person",
// //       "Today is a sunny day",
// //     ],
// //   },
// // }).then((response) => {
// //   console.log(JSON.stringify(response));
// // });
