import fs from "fs";

const FILE_NAME = "generated_embeddings.json";
const EMBED_DIMS = 1500;

// ----------------- FONCTIONS ----------------- //
async function embedding_generation(texts: string[]) {
  const response = await fetch(
    "https://api.openai.com/v1/embeddings?model=text-embedding-3-small",
    {
      headers: {
        Authorization:
          "Bearer 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",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        input: texts,
        model: "text-embedding-3-small",
      }),
    }
  );
  const brutResults:
    | {
        objets: string;
        data: { object: string; index: number; embedding: number[] }[];
        model: string;
        usage: { prompt_tokens: number; total_tokens: number };
      }
    | { error: { message: string; type: string; param: any; code: any } } =
    await response.json();

  if ("error" in brutResults) {
    console.log(brutResults);
  } else {
    // Sauvegarde des resultats
    const results = brutResults.data.map((data, index) => ({
      text: texts[index],
      embedding: data.embedding.slice(0, EMBED_DIMS),
      usageForSelection: index === 0 ? brutResults.usage : undefined,
    }));
    const prevRes = JSON.parse(fs.readFileSync(FILE_NAME, "utf8")) as any[];
    const newRes = JSON.stringify([...prevRes, ...results]);
    fs.writeFile(FILE_NAME, newRes, (err) => {});

    return results;
  }
}
function cosineSimilarity(vecA: any, vecB: any) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ----------------- TESTS ----------------- //
(async function () {
  const texts = [
    "couchette pour 2",
    "Lit 2 personnes très confortable ayant une largeur comprise entre 30cm et 50cm",
  ];

  const embeddings = await embedding_generation(texts);
  // const file = fs.readFileSync(FILE_NAME, "utf8");
  // const embeddings = JSON.parse(file) as any[];
  if (embeddings) {
    console.log(
      cosineSimilarity(embeddings[0].embedding, embeddings[1].embedding)
    );
  }
})();
