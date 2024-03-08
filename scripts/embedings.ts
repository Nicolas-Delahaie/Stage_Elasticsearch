import fs from "fs";

const FILE_NAME = "generated_embeddings.json";
const EMBED_DIMS = 200;

async function query(texts: string[]) {
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
  const brutResults = (await response.json()) as {
    objets: string;
    data: { object: string; index: number; embedding: number[] }[];
    model: string;
    usage: { prompt_tokens: number; total_tokens: number };
  };

  // Sauvegarde des resultats
  const results = brutResults.data.map((data, index) => ({
    text: texts[index],
    embedding: data.embedding.slice(0, EMBED_DIMS),
    usageForSelection: index === 0 ? brutResults.usage : undefined,
  }));
  const embeddings = JSON.parse(fs.readFileSync(FILE_NAME, "utf8")) as any[];
  const embeddingsWithNew = JSON.stringify([...embeddings, ...results]);
  fs.writeFile(FILE_NAME, embeddingsWithNew, (err) => {});
}

query([
  // "Today is a sunny day",
  // "That is a very happy person",
  // "That is a happy dog",
  // "Essentiel pour préserver son matelas, l'alèse spécialement adaptée au matelas berceau TROLL.<br>Coloris écru.<br>100 % coton waterproof, intérieur 100 % polyester, bordures avec élastique <br> Lavable en machine à 95°<br><br>",
]);

// const embeddings = JSON.parse(fs.readFileSync(FILE_NAME, "utf8")) as any[];
// console.log(embeddings[0].embedding.length);
