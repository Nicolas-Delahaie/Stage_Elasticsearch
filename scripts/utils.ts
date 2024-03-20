import fs from "fs";
import asciiTranslations from "./format_files/asciiTranslations.json";
import frStopwords from "./format_files/stopwords-fr.json";

const MODEL_NAME = "text-embedding-3-small";

type resFunction =
  | {
      success: true;
      data: number[][];
      tokens: number;
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
      usage: { prompt_tokens: number; total_tokens: number };
    }
  | { error: apiError };
type apiError = { message: string; type: string; param: any; code: any };
export async function requestEmbeddingApi(texts: string[], dimensions: number): Promise<resFunction> {
  let config;
  try {
    config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
  } catch (e) {
    throw Error("Impossible de lire le fichier de configuration (config.json)");
  }

  const openAIKey = config.openai_key;
  if (!openAIKey) throw Error("Impossible de trouver la clé d'API d'OpenAI");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      headers: {
        Authorization: `Bearer ${openAIKey}`,
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
        tokens: brutResults.usage?.total_tokens,
      };
}

export function storeTokenCount(tokenCount: number, isNew = false, type?: string) {
  type use = {
    date: string;
    counter: number;
    type: string;
  };

  if (isNew && !type) {
    throw Error("[storeTokenCount] Erreur : besoins du type ");
  }

  const FILE_NAME = "results/tokenUse.json";
  let uses: use[];
  try {
    uses = JSON.parse(fs.readFileSync(FILE_NAME, "utf8"));
  } catch (e) {
    console.log("   création du fichier tokenUse.json");
    uses = [];
  }

  if (isNew && type) {
    const now = new Date();
    uses.push({ date: now.toISOString(), counter: tokenCount, type });
  } else {
    const iLaterUse = uses.length - 1;
    uses[iLaterUse].counter += tokenCount;
  }

  fs.writeFileSync(FILE_NAME, JSON.stringify(uses));
}

/**
 * Enleve tous les elements inutiles et uniformise :
 * - Balises
 * - Minuscule
 * - Suppression des apostrophes (elision)
 * - Transformation de toutes les lettres uniquement en ASCII
 * - Suppression caracteres speciaux
 * - Suppression des doublons
 *
 * - Suppression des stopwords français
 * - Dimensions
 * - Offres
 */
export function cleaner(text: string, isFr = false) {
  const tagRegex = /<[^>]*>/g;
  const largeSpaceRegex = / {2,}/g; // Pour retirer les espaces generes par la suppression des balises
  const regexPromos =
    /(\* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5)|(- Offre -5%)|(A partir [0-9]+ € D'ACHAT = [0-9]+% DE REMISE-code promo OFFRE[0-9]+)|(Offre de Bienvenue : 5% avec le code promo : PROMO5)|(DERNIÈRE DEMARQUE -10% SUPPLEMENTAIRES.*AVEC LE CODE PROMO : 10)/;
  const regexDimensions = /[0-9]+ ?x ?[0-9]+( cm)?/;
  const spaceRegex = /\s+/g;
  const elisionRegex = /(l|d|m|t|s|j)('|\u2019)/g; // u2019 : ’
  const specialCharRegex = /\W+/g;
  const numbersRegex = /[0-9]+/;

  // -- Global --
  text = text.replace(tagRegex, " "); // Oblige de mettre un espace a la place sinon des mots se colleraient ensemble
  text = text.replace(largeSpaceRegex, " "); // Certaines balises collees generent plusieurs espaces a la suite
  if (isFr) {
    text = text.replace(regexPromos, "");
    text = text.replace(regexDimensions, "");
  }

  // -- Pour de chaque token --
  let tokens = text
    .split(spaceRegex)
    .map((token) => {
      token = token.toLowerCase();
      if (isFr) {
        token = token.replace(elisionRegex, "");
        if (frStopwords.includes(token)) {
          return null;
        } // Stop words
      }
      token = asciiFolder(token); // Transformation de toutes les lettres en ASCII (plus d accent notament)
      token = token.replace(specialCharRegex, "");
      token = token.replace(numbersRegex, "");

      return token;
    })
    .filter((token) => !(token === null || token === "")) as string[];

  // Suppression doublons
  tokens = [...new Set(tokens)];

  return tokens.join(" ");
}

function asciiFolder(text: string) {
  type traduction = {
    base: string;
    letters: string;
  };
  const changes = asciiTranslations as traduction[];

  for (var i = 0; i < changes.length; i++) {
    text = text.replace(new RegExp(changes[i].letters), changes[i].base);
  }
  return text;
}

export function storeInResultFile(object: unknown, fileName: string) {
  let newContent;

  if (object === null) {
    newContent = { message: "null object unstorable" };
  } else if (object instanceof Error) {
    newContent = {
      message: object.message,
      name: object.name,
      stack: object.stack,
    };
  } else if (typeof object === "string") {
    newContent = { message: object };
  } else if (typeof object === "object") {
    newContent = object;
  } else {
    newContent = { message: "object unstorable" };
  }

  fs.writeFileSync("results/" + fileName, JSON.stringify(newContent));
}

/**
 * Combine les 2 embeddings.
 */
export function combineEmbeddings(emb1: number[], emb2: number[], weightTitle: number, weightDescription: number) {
  const combinedEmbedding = [];
  for (let i = 0; i < emb1.length; i++) {
    combinedEmbedding[i] = (weightTitle * emb1[i] + weightDescription * emb2[i]) / (weightTitle + weightDescription);
  }
  return combinedEmbedding;
}

export function normalizeEmbedding(embedding: number[]) {
  if (!embedding) throw Error("[normalizeEmbedding] embedding is falsy");
  const norm = vectorNorm(embedding);
  return embedding.map((dimension) => dimension / norm);
}

function vectorNorm(vector: number[]) {
  let sumOfSquares = 0;
  for (const dimension of vector) {
    sumOfSquares += dimension * dimension;
  }
  return Math.sqrt(sumOfSquares);
}

// ----------------- TESTS ----------------- //
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
async function testSimiliarite() {
  const texts = [
    "David Mathy",
    // '<div></div><div>* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5<br></div><div><br></div><div>Un gain de place assuré avec le lit mezzanine.<br></div><div>Résolument contemporain pour une ambiance zen et chaleureuse.<br>Sa finition, couleur cappuccino et les chants en bois huilés, lui confèrent à la fois douceur et robustesse.<br><br>Le panneau fermé d\'un côté permet un gain de place dans la chambre de votre enfant vous pourrez adosser une commode ou un bureau à l\'extérieur et des étagères à l\'intérieur.<br> Sous la mezzanine possibilité de créer un espace de jeu, de travail ou d\'installer un lit supplémentaire.<br>L\'échelle se positionne au choix lors du montage à gauche ou à droite.<br><table border="0" cellpadding="0" cellspacing="0" width="390" style="border-collapse: collapse; width: 390pt;"><colgroup><col width="65" span="6" style="width: 65pt;"></colgroup><tbody><tr height="15" style="height: 15pt;"><td height="15" colspan="4" width="260" style="height: 15pt; width: 260pt;"><b>EXCEPTIONNEL ! Jusqu\'au 31 janvier 2015</b></td><td width="65" style="width: 65pt;"></td><td width="65" style="width: 65pt;"></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir de 1000 € D\'ACHAT = 5% DE REMISE-code promo OFFRE5</b></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir 1800 € D\'ACHAT = 7% DE REMISE-code promo OFFRE7</b></td></tr></tbody></table></div><div><br></div><div>Hauteur totale 165 cm, hauteur sous sommier 127 cm.<br><br>Afin de respecter la norme de sécurité pour le lit mezzanine, il conviendra de respecter une épaisseur maximale de 17cm (matelas + sommier)<br>Convient à partir de 6 ans<br><br>Étagère vendue séparément<br>Voir notre rubrique Accessoires lit enfant.<br><br>Tous les lits Mathy By Bols peuvent être fabriqués en couchage longueur 200 au même tarif, si vous souhaitez cette dimension validez le modèle 90X190 et précisez : DIMENSION COUCHAGE 90x200 lors du récapitulatif de commande, rubrique 5.MESSAGE.<b style="font-weight: bold;"><b><br><br></b></b><br></div>',
    "Coucou",
  ];

  const res = await requestEmbeddingApi(texts, 100);
  console.log(res);
  if (res.success) {
    // console.log(cosineSimilarity(res.data[0], res.data[1]));
  }
}
