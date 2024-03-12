import fs from "fs";

const FILE_NAME = "generated_embeddings.json";
const MODEL_NAME = "text-embedding-3-small";
const EMBED_DIMS = 256;

// ----------------- FONCTIONS ----------------- //
async function embedding_generation(texts: string[]) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    headers: {
      Authorization:
        "Bearer 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",
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({
      input: texts,
      model: MODEL_NAME,
      dimensions: EMBED_DIMS,
    }),
  });
  const brutResults:
    | {
        objets: string;
        data: { object: string; index: number; embedding: number[] }[];
        model: string;
        usage?: { prompt_tokens: number; total_tokens: number };
      }
    | { error: { message: string; type: string; param: any; code: any } } =
    await response.json();

  if ("error" in brutResults) {
    console.log(brutResults);
  } else {
    // Sauvegarde des resultats
    const results = brutResults.data.map((data, index) => ({
      text: texts[index],
      embedding: data.embedding,
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
    "David Mathy",
    "Caisson pour bureau David Mathy By Bols",
    // '<div></div><div>* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5<br></div><div><br></div><div>Un gain de place assuré avec le lit mezzanine.<br></div><div>Résolument contemporain pour une ambiance zen et chaleureuse.<br>Sa finition, couleur cappuccino et les chants en bois huilés, lui confèrent à la fois douceur et robustesse.<br><br>Le panneau fermé d\'un côté permet un gain de place dans la chambre de votre enfant vous pourrez adosser une commode ou un bureau à l\'extérieur et des étagères à l\'intérieur.<br> Sous la mezzanine possibilité de créer un espace de jeu, de travail ou d\'installer un lit supplémentaire.<br>L\'échelle se positionne au choix lors du montage à gauche ou à droite.<br><table border="0" cellpadding="0" cellspacing="0" width="390" style="border-collapse: collapse; width: 390pt;"><colgroup><col width="65" span="6" style="width: 65pt;"></colgroup><tbody><tr height="15" style="height: 15pt;"><td height="15" colspan="4" width="260" style="height: 15pt; width: 260pt;"><b>EXCEPTIONNEL ! Jusqu\'au 31 janvier 2015</b></td><td width="65" style="width: 65pt;"></td><td width="65" style="width: 65pt;"></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir de 1000 € D\'ACHAT = 5% DE REMISE-code promo OFFRE5</b></td></tr><tr height="15" style="height: 15pt;"><td height="15" colspan="6" style="height: 15pt;"><b>A partir 1800 € D\'ACHAT = 7% DE REMISE-code promo OFFRE7</b></td></tr></tbody></table></div><div><br></div><div>Hauteur totale 165 cm, hauteur sous sommier 127 cm.<br><br>Afin de respecter la norme de sécurité pour le lit mezzanine, il conviendra de respecter une épaisseur maximale de 17cm (matelas + sommier)<br>Convient à partir de 6 ans<br><br>Étagère vendue séparément<br>Voir notre rubrique Accessoires lit enfant.<br><br>Tous les lits Mathy By Bols peuvent être fabriqués en couchage longueur 200 au même tarif, si vous souhaitez cette dimension validez le modèle 90X190 et précisez : DIMENSION COUCHAGE 90x200 lors du récapitulatif de commande, rubrique 5.MESSAGE.<b style="font-weight: bold;"><b><br><br></b></b><br></div>',
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
