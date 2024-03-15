import frStopwords from "./stopwords-fr.json";
import { asciiFolder } from "./asciiFolder";

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
