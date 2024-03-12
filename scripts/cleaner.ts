// function remove_stopwords(str) {
//   res = [];
//   words = str.split(" ");
//   for (i = 0; i < words.length; i++) {
//     word_clean = words[i].split(".").join("");
//     if (!stopwords.includes(word_clean)) {
//       res.push(word_clean);
//     }
//   }
//   return res.join(" ");
// }

import { T_sku } from "./script";

/**
 * Supprime tous les elements en trop de la langue francaise :
 * - Dimensions
 * - Nombres
 * - Balises
 * - Offres
 */
export function cleaner(skus: T_sku[]) {
  return skus.map((sku) => ({
    skuGuid: sku.skuGuid,
    skuDescription: {
      ...sku.skuDescription,
      fr: applyRegex(sku.skuDescription.fr ?? ""),
    },
    skuName: {
      ...sku.skuName,
      fr: applyRegex(sku.skuName.fr ?? ""),
    },
  }));

  function applyRegex(text: string) {
    const regexPromos =
      /(\* Offre de bienvenue 5% de réduction sur votre 1ère commande avec le code: PROMO5)|(- Offre -5%)|(A partir [0-9]+ € D'ACHAT = [0-9]+% DE REMISE-code promo OFFRE[0-9]+)|(Offre de Bienvenue : 5% avec le code promo : PROMO5)|(DERNIÈRE DEMARQUE -10% SUPPLEMENTAIRES.*AVEC LE CODE PROMO : 10)/;
    const regexDimensions = /[0-9]+ ?x ?[0-9]+( cm)?/;
    const regexBalises = /<[^>]*>/g;
    const longsEspaces = / {2,}/g; // Pour retirer les espaces generes par la suppression des balises
    const regexNombres = /[0-9]+ ?(€|°|%)?/g;
    text = text.replace(regexPromos, "");
    text = text.replace(regexDimensions, "");
    text = text.replace(regexBalises, " ");
    text = text.replace(longsEspaces, " ");
    text = text.replace(regexNombres, "");
    return text;
  }
}
