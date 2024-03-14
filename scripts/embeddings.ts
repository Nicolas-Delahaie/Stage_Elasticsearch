const MODEL_NAME = "text-embedding-3-small";

export async function embeddingApi(texts: string[], dimensions: number) {
  const CHARS_IN_A_TOKEN = 4; // Moyenne de nombre de caracteres par token
  const MAX_TOKENS_PER_SECTION = 7000; // Au lieu de 8191 pour etre large
  const MAX_CHARS_PER_SECTION = MAX_TOKENS_PER_SECTION * CHARS_IN_A_TOKEN;
  const SECTION_RATIO_REDUCTION = 6;

  let charCounter = 0;
  let iLastSectionText = 0;
  let requestFailed = false;
  let embeddings: number[][] = [];
  while (texts.length !== 0) {
    if (!requestFailed) {
      const textLength = texts[iLastSectionText].length;
      charCounter += textLength;
    }
    const isLastElement = iLastSectionText == texts.length - 1;

    if (requestFailed || isLastElement || charCounter > MAX_CHARS_PER_SECTION) {
      // Tentative de generation d embedding
      const section = texts.slice(0, iLastSectionText + 1);
      const others = texts.slice(iLastSectionText + 1);
      console.log("DEBUG - Envoi des textes : ", section);
      const res = await requestEmbeddingApi(section, dimensions);
      /**@todo INTEGRER L AJOUT DANS ELASTIC SEARCH ICI (pour ne pas faire des embeddings pour rien au cas ou une section fasse planter) */
      if (res.success) {
        // Stockages des embeddings
        console.log(res.data);
        embeddings.push(...res.data);

        // Reinitialisation donnees
        charCounter = 0;
        requestFailed = false;

        // Reduction des textes restants a envoyer
        texts = others;
        iLastSectionText = 0;
        console.log(section.length, " embeddings générés !");
      } else {
        const typeErreur = res.error.type;
        if (typeErreur === "invalid_request_error") {
          // Tant que la section ne peut pas etre envoyee, elle est reduite
          requestFailed = true;
          iLastSectionText -= Math.ceil(iLastSectionText / SECTION_RATIO_REDUCTION);
          console.log("Trop grand nombre de tokens pour l'API d'OpenAI : reduction des donnees");
        } else if (typeErreur === "rate_limit_error") {
          throw Error("Impossible de continuer, nombre de requetes max autorisées par OpenAI atteint");
        } else if (typeErreur === "internal_server_error " || typeErreur === "service_unavailable") {
          throw Error("Probleme interne d'OpenAI, impossible de générer les embeddings");
        } else {
          throw Error("Impossible de generer les embeddings OpenAI");
        }
      }
    } else {
      iLastSectionText++;
    }
  }

  return embeddings;
}

type resFunction =
  | {
      success: true;
      data: number[][];
    }
  | {
      success: false;
      error: apiError;
    };
type resApi =
  | {
      objets: string;
      data: { object: string; index: number; embedding: number[] }[];
      model: string;
      usage?: { prompt_tokens: number; total_tokens: number };
    }
  | { error: apiError };
type apiError = { message: string; type: string; param: any; code: any };
async function requestEmbeddingApi(texts: string[], dimensions: number): Promise<resFunction> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      headers: {
        Authorization: "Bearer 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",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        input: texts,
        model: MODEL_NAME,
        dimensions,
      }),
    });
  } catch (error) {
    throw Error("impossible d'accéder à l'API d'OpenAI");
  }

  const brutResults: resApi = await res.json();

  return "error" in brutResults
    ? {
        success: false,
        error: brutResults.error,
      }
    : {
        success: true,
        data: brutResults.data.map((data) => data.embedding),
      };
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
async function testSimiliarite() {
  const texts = [
    "David Mathy",
    // '<div></div><div>* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5<br></div><div><br></div><div>Un gain de place assuré avec le lit mezzanine.<br></div><div>Résolument contemporain pour une ambiance zen et chaleureuse.<br>Sa finition, couleur cappuccino et les chants en bois huilés, lui confèrent à la fois douceur et robustesse.<br><br>Le panneau fermé d\'un côté permet un gain de place dans la chambre de votre enfant vous pourrez adosser une commode ou un bureau à l\'extérieur et des étagères à l\'intérieur.<br> Sous la mezzanine possibilité de créer un espace de jeu, de travail ou d\'installer un lit supplémentaire.<br>L\'échelle se positionne au choix lors du montage à gauche ou à droite.<br><table border="0" cellpadding="0" cellspacing="0" width="390" style="border-collapse: collapse; width: 390pt;"><colgroup><col width="65" span="6" style="width: 65pt;"></colgroup><tbody><tr height="15" style="height: 15pt;"><td height="15" colspan="4" width="260" style="height: 15pt; width: 260pt;"><b>EXCEPTIONNEL ! Jusqu\'au 31 janvier 2015</b></td><td width="65" style="width: 65pt;"></td><td width="65" style="width: 65pt;"></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir de 1000 € D\'ACHAT = 5% DE REMISE-code promo OFFRE5</b></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir 1800 € D\'ACHAT = 7% DE REMISE-code promo OFFRE7</b></td></tr></tbody></table></div><div><br></div><div>Hauteur totale 165 cm, hauteur sous sommier 127 cm.<br><br>Afin de respecter la norme de sécurité pour le lit mezzanine, il conviendra de respecter une épaisseur maximale de 17cm (matelas + sommier)<br>Convient à partir de 6 ans<br><br>Étagère vendue séparément<br>Voir notre rubrique Accessoires lit enfant.<br><br>Tous les lits Mathy By Bols peuvent être fabriqués en couchage longueur 200 au même tarif, si vous souhaitez cette dimension validez le modèle 90X190 et précisez : DIMENSION COUCHAGE 90x200 lors du récapitulatif de commande, rubrique 5.MESSAGE.<b style="font-weight: bold;"><b><br><br></b></b><br></div>',
  ];

  const embeddings = await requestEmbeddingApi(texts, 100);

  // console.log(cosineSimilarity(embeddings[0], embeddings[1]));
}

async function test() {
  let texts;
  texts = [Array(10).fill("cafff").join(" ")];
  console.log(await embeddingApi(texts, 10));
  // if (!embeddings.success) {
  //   console.log(embeddings.error.message.match(/^\D*\d+\D+(\d+)/)?.[1]);
  // }

  texts = ["Coucou moi anticonstitionnellement", "hgbyu", "uhuih", "uhuih"];
}

test();
