import { Elasticsearch } from "../scripts/script";

const ets = new Elasticsearch();

async function analyzer(text: string) {
  // Envoi
  const res = await ets.indices.analyze({
    index: ets.INDEX_NAME,
    body: {
      text,
      analyzer: "embedding_analyzer",
    },
  });

  // Analyse
  if (!res.tokens) {
    throw Error("Analyseur d'embedding a écouché");
  }

  // Formattage
  const tokensApi = res.tokens.map((token) => token.token);
  console.log(tokensApi);
}
