using CentralStation.Components.Elasticsearch;
using CentralStation.Components.OpenAI;
using CentralStationService.Helpers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using System;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
namespace CentralStationService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ElasticsearchController : ControllerBase
    {
        private const bool DEBUG_MODE = true;
        private const int EMBEDDING_DIMS = 1536;

        private const string ELASTIC_PATH = "https://localhost:9200/";
        private const string INDEX_NAME = "skus";
        private const string PASSWORD = "tact060103";   // @todo lier les identifiants au .env du docker compose
        private const int MAX_BULK_LENGTH_MB = 52;      // Defini dans le mem_limit du docker compose
        private readonly ElasticsearchRequest elastic;
        private readonly OpenAIRequest openAI;

        private static readonly log4net.ILog _log = log4net.LogManager.GetLogger(typeof(ElasticsearchController));
        private readonly AppSetting _myAppSettings = new();
        private readonly IStringLocalizer<CatalogsController> _localizer;
        private readonly IHttpContextAccessor _httpContextAccessor;

        public ElasticsearchController(
             // IStringLocalizer<Localization.SharedResource> sharedLocalizer,
             //IStringLocalizer<AuthenticateController> localizer,
             IOptions<AppSetting> myAppSettings,
             IHttpContextAccessor httpContextAccessor
            )
        {
            _httpContextAccessor = httpContextAccessor;
            log4net.ThreadContext.Properties["service"] = "NUDE";
            _myAppSettings = myAppSettings.Value;
            //_localizer = localizer;

            //string? alias = httpContextAccessor?.HttpContext?.User.Claims.FirstOrDefault(c => c.Type == "Alias")?.Value;
            //if (!string.IsNullOrEmpty(alias))
            //    log4net.ThreadContext.Properties["alias"] = alias;


            //    CentralStation.Notification notif = new()
            //    {
            //        NotificationType = CentralStation.Notification.Type.IMPORT,
            //        NotificationTitleJson = CentralStation.Toolbox.FunctionBox.BuildObjectLanguage(sharedLocalizer, "IMPORT_START"),
            //        NotificationCommentJson = CentralStation.Toolbox.FunctionBox.BuildObjectLanguage(sharedLocalizer, "IMPORT_START_IMPORT"),
            //        NotificationOwner = owner,
            //        NotificationLanguage = language
            //    };


            openAI = new(DEBUG_MODE, EMBEDDING_DIMS);
            elastic = new("elastic", PASSWORD, ELASTIC_PATH, INDEX_NAME, DEBUG_MODE, MAX_BULK_LENGTH_MB);
        }


        /// <summary>
        /// Initialise la base de données Elastic search a partir des donnees fournies
        /// </summary>
        /// <param name="clientName">Client dont on veut migrer la bdd sur elastic seach</param>
        /// <returns></returns>
        /// 
        [HttpGet("initialization")]
        [AllowAnonymous]
        public async Task<IActionResult> Initialization(string clientName = "babyroom")
        {
            const int NAME_WEIGHT = 3;
            const int DESCRIPTION_WEIGHT = 1;

            try
            {
                //GlobalsInitializer.Initializer(
                //    string.Format(_myAppSettings.ConnectionString, ((ClaimsIdentity)User.Identity).FindFirst("BddName").Value),
                //    ((ClaimsIdentity)User.Identity).FindFirst("SettingsPath").Value,
                //    ((ClaimsIdentity)User.Identity).FindFirst("Language").Value);

                //var lstSkuObjects = await CentralStation.External.Sku.GetAllSkus(0, 10000, "", "like", "", "fr", "c81e5e55-956f-4ea2-bbfc-95cdd4d68ddd");
                //var a = lstSkuObjects.ToObject<Sku[]>();

                // ----------------------- PRE VERICATIONS -----------------------
                if (DEBUG_MODE) Console.WriteLine("Verification Elasticsearch et OpenAI en bon etat... ");
                try
                {
                    var httpClient = new HttpClient(new HttpClientHandler
                    {
                        ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
                    });
                    await httpClient.GetAsync(OpenAIRequest.OPENAI_PATH);
                    await httpClient.GetAsync(ELASTIC_PATH);
                    await openAI.RequestEmbeddingApi(new string[] { "Test to verify openAI key is working." });
                }
                catch (Exception e)
                {
                    throw new Exception("Server error", e);
                }


                // ----------------------- INDEX CREATION -----------------------
                if (DEBUG_MODE) Console.WriteLine("Creation de l'index... ");
                elastic.CreateIndex(EMBEDDING_DIMS);


                // ----------------------- DATAS IMPORTS-----------------------
                if (DEBUG_MODE) Console.WriteLine("Importation fichier JSON... ");
                var skus = Utils.ImportJsonFile<CentralStation.Components.Elasticsearch.Sku[]>("Resources/" + clientName + ".json");
                //skus = skus.SelectMany(x => Enumerable.Repeat(x, 60)).ToArray();


                // ----------------------- DATAS UNIFORMIZATION -----------------------
                if (DEBUG_MODE) Console.WriteLine("Uniformisation des documents... ");
                Stopwatch stopwatch = new Stopwatch();
                stopwatch.Start();
                //skus = skus.Take(10).ToArray();
                foreach (var sku in skus)
                {
                    sku.SkuCleaning();
                }
                stopwatch.Stop();
                Console.WriteLine("--> " + stopwatch.ElapsedMilliseconds + "ms");


                // ----------------------- EMBEDDINGS GENERATION -----------------------
                double[]?[] descriptionEmbeddings, nameEmbeddings;
                if (DEBUG_MODE) Console.WriteLine("Generation des embeddings de description non nulles... ");
                descriptionEmbeddings = await openAI.BulkEmbeddingApi(skus
                  .Select((sku) => sku.SkuDescription?.Fr ?? "")
                  .ToArray()
                );
                if (DEBUG_MODE) Console.WriteLine("Generation des embeddings de titre non nuls... ");
                nameEmbeddings = await openAI.BulkEmbeddingApi(skus
                    .Select((sku) => sku.SkuName?.Fr ?? "")
                    .ToArray()
                );


                // ----------------------- EMBEDDINGS FUSION -----------------------
                if (DEBUG_MODE) Console.WriteLine("Fusion des embeddings... ");
                for (int i = 0; i < nameEmbeddings.Length; i++)
                {
                    skus[i].Embedding = Sku.CombineEmbeddings(nameEmbeddings[i], descriptionEmbeddings[i], NAME_WEIGHT, DESCRIPTION_WEIGHT);
                }


                //if (DEBUG_MODE) Console.WriteLine("Ajout des embeddings dans Postgre... ");
                //foreach (var item in skus)
                //{
                //    var res = CentralStation.Sku.UpdateFieldSku(item.SkuGuid ?? "", "embedding", JsonConvert.SerializeObject(item.Embedding), "vector", "babyroom", "");
                //    if (res == false)
                //    {
                //        Console.WriteLine("ERREUR SUR L'ARTICLE " + item.SkuGuid + " : " + item.SkuName?.Fr + " - " + item.SkuDescription?.Fr + " - " + item.Embedding);
                //    }
                //}

                // ----------------------- SKUS INDEXATION -----------------------
                if (DEBUG_MODE) Console.WriteLine("Indexation des produits... ");
                //var testSkus = Sku.generateSkus(250, EMBEDDING_DIMS);
                elastic.BulkIndexingApi(skus);


                if (DEBUG_MODE) Console.WriteLine("Initialisation terminee ! ");
                return Ok();
            }
            catch (Exception ex)
            {
                _log.Error(ex);
                if (DEBUG_MODE) Console.WriteLine("\u274C Initialisation ratee :", ex);
                return StatusCode(500, ex.Message);
            }
        }

        //private static void sendNotif()
        //{
        //    string owner = ((System.Security.Claims.ClaimsIdentity)User.Identity).FindFirst("UserLogin").Value;
        //    string language = ((ClaimsIdentity)User.Identity).FindFirst("Language").Value;

        //    CentralStation.Notification notif = new()
        //    {
        //        NotificationType = CentralStation.Notification.Type.IMPORT,
        //        NotificationTitleJson = CentralStation.Toolbox.FunctionBox.BuildObjectLanguage(_sharedLocalizer, "IMPORT_VALIDATION"),
        //        NotificationCommentJson = CentralStation.Toolbox.FunctionBox.BuildObjectLanguage(_sharedLocalizer, "IMPORT_VALIDATION_VALID"),
        //        NotificationOwner = owner,
        //        NotificationLanguage = language
        //    };
        //}
    }

}

