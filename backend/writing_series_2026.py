"""Expression écrite — the monthly exam series of July, August and September 2026.

Transcribed from "TCF Canada — Expression écrite — Sujets d’entraînement :
Juillet, Août et Septembre 2026". The subjects are original compositions
written from the themes of each combinaison published on reussir-tcfcanada.com
for those sessions; `source` names the combinaison a series was built from.

Each series has the real paper's format: three tâches in 60 minutes — a short
message (60–120 words), an article, email or account (120–150 words), and an
argumentative text (120–180 words) that summarises two opposed documents and
then argues a position.

One entry per series, in the order the document gives them (September first).
`index` is the number of the series within its month, which is what the page
prints; the global set number a candidate's attempts are filed under is
assigned in exam_sets.py by position. Do not reorder — the numbering is
positional.

The word ranges the document prints after each consigne are left out. The
simulator already shows the official range beside every tâche and counts
against it, so carrying it inside the subject only says it twice.
"""

# The tâche 3 instruction, identical on all eighteen series and on the real
# paper, so it is written once here rather than copied into every entry.
WRITING_T3_CONSIGNE = (
    "Résumez les deux points de vue (40 à 60 mots), puis donnez votre opinion "
    "en l’argumentant (80 à 120 mots). Total : 120 à 180 mots.")

WRITING_SERIES_2026 = [
    # Septembre 2026 · série 1 — série S1, d’après la Combinaison 9
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 1,
     "source": "d’après la Combinaison 9",
     "tache1": "Le parc de votre ville accueille un concert gratuit en plein "
               "air samedi prochain. Vous écrivez à un(e) ami(e) pour "
               "l’inviter à venir avec vous. Vous précisez la date, l’heure, "
               "le programme et la manière de s’y rendre.",
     "tache2": "Sur un site d’avis en ligne, vous racontez le repas que vous "
               "avez pris récemment dans un nouveau restaurant de votre "
               "quartier (ambiance, plats, accueil, prix). Vous dites si "
               "vous le recommandez et pourquoi.",
     "tache3": {"title": "Voyager seul ou en groupe ?",
                "doc_1": "Partir seul, c’est choisir chaque étape de son "
                         "itinéraire sans négocier avec personne. Le "
                         "voyageur solitaire avance à son propre rythme, "
                         "change de programme quand il le souhaite et ose "
                         "davantage aller vers les habitants. Beaucoup de "
                         "personnes qui ont tenté l’expérience affirment "
                         "être revenues plus confiantes et plus autonomes, "
                         "car elles ont dû régler seules les petites "
                         "difficultés du quotidien.",
                "doc_2": "Voyager à plusieurs reste, pour beaucoup, la "
                         "formule la plus rassurante. En cas de maladie, de "
                         "perte de documents ou de retard de transport, on "
                         "peut compter sur ses compagnons. Le groupe permet "
                         "aussi de partager certains frais, comme le "
                         "logement ou la location d’une voiture. Enfin, "
                         "vivre de beaux moments ensemble crée des souvenirs "
                         "communs que l’on aime évoquer des années plus "
                         "tard."}},
    # Septembre 2026 · série 2 — série S2, d’après la Combinaison 8
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 2,
     "source": "d’après la Combinaison 8",
     "tache1": "Un(e) collègue va habiter dans votre appartement pendant "
               "votre déplacement professionnel. Vous lui écrivez pour lui "
               "expliquer comment entrer dans l’immeuble, où trouver les "
               "clés et ce qu’il/elle doit savoir sur le logement "
               "(chauffage, poubelles, voisins, etc.).",
     "tache2": "Un magazine de voyage invite ses lecteurs à partager un "
               "voyage inoubliable. Vous racontez ce voyage et vous "
               "expliquez pourquoi il vous a particulièrement marqué(e).",
     "tache3": {"title": "Quitter le domicile familial : le plus tôt possible ?",
                "doc_1": "Avec la hausse des loyers, de plus en plus de "
                         "jeunes adultes choisissent de rester chez leurs "
                         "parents jusqu’à la fin de leurs études, voire "
                         "après. Ils économisent pour acheter un logement "
                         "plus tard, profitent du soutien de leur famille et "
                         "peuvent se concentrer sur leur formation ou leur "
                         "premier emploi sans pression financière.",
                "doc_2": "Pour d’autres, partir tôt est indispensable pour "
                         "devenir adulte. Gérer un budget, faire ses "
                         "courses, payer ses factures et organiser son "
                         "quotidien sont des apprentissages que l’on fait "
                         "rarement chez ses parents. Selon plusieurs "
                         "psychologues, les jeunes qui prennent leur "
                         "indépendance tôt gagnent en maturité et en "
                         "confiance en eux."}},
    # Septembre 2026 · série 3 — série S3, d’après la Combinaison 7
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 3,
     "source": "d’après la Combinaison 7",
     "tache1": "La médiathèque de votre quartier organise une soirée de "
               "lecture et de dédicaces avec une autrice connue. Vous "
               "écrivez à un(e) ami(e) pour l’inviter à venir avec vous "
               "(date, lieu, programme, inscription).",
     "tache2": "Vous avez participé à un festival gastronomique dans votre "
               "ville. Sur votre blog, vous racontez cette expérience "
               "(stands, dégustations, ateliers) et vous dites ce qui vous a "
               "le plus plu.",
     "tache3": {"title": "Les fresques murales : embellissement ou nuisance ?",
                "doc_1": "De nombreuses municipalités invitent aujourd’hui "
                         "des artistes à peindre de grandes fresques sur les "
                         "murs des quartiers. Ces œuvres colorées "
                         "transforment des rues grises en galeries à ciel "
                         "ouvert, attirent les visiteurs et redonnent de la "
                         "fierté aux habitants. Certaines villes proposent "
                         "même des parcours guidés pour découvrir ces "
                         "créations.",
                "doc_2": "Tout le monde n’apprécie pas cette évolution. Des "
                         "habitants se plaignent de tags réalisés sans "
                         "autorisation sur leurs façades ou dans les "
                         "transports. Le nettoyage coûte cher aux "
                         "propriétaires et aux collectivités. Pour eux, la "
                         "frontière entre l’art et la dégradation est trop "
                         "floue, et les règles devraient être appliquées "
                         "plus sévèrement."}},
    # Septembre 2026 · série 4 — série S4, d’après la Combinaison 6
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 4,
     "source": "d’après la Combinaison 6",
     "tache1": "Un(e) ami(e) souhaite s’inscrire à l’école de musique que "
               "vous fréquentez. Vous lui écrivez pour lui donner toutes les "
               "informations utiles (adresse, horaires, tarifs, instruments "
               "et cours proposés).",
     "tache2": "Vous êtes bénévole dans une association qui aide les enfants "
               "en difficulté scolaire. Vous écrivez un article pour le site "
               "de l’association afin de raconter votre engagement et "
               "d’encourager d’autres personnes à vous rejoindre.",
     "tache3": {"title": "Faut-il offrir un animal à son enfant ?",
                "doc_1": "Selon de nombreux spécialistes de l’enfance, "
                         "grandir avec un animal présente de réels "
                         "avantages. L’enfant apprend à prendre soin d’un "
                         "être vivant, développe son sens des "
                         "responsabilités et se sent moins seul. Promener un "
                         "chien ou nourrir un chat chaque jour l’aide aussi "
                         "à respecter une routine et à gagner en autonomie.",
                "doc_2": "Les refuges constatent pourtant qu’un grand nombre "
                         "d’animaux sont abandonnés quelques mois après "
                         "avoir été offerts. Les enfants se lassent vite, et "
                         "ce sont souvent les parents qui doivent s’en "
                         "occuper. Nourriture, vétérinaire, garde pendant "
                         "les vacances : un animal représente un coût et un "
                         "engagement sur de longues années."}},
    # Septembre 2026 · série 5 — série S5, d’après la Combinaison 5
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 5,
     "source": "d’après la Combinaison 5",
     "tache1": "Vous préparez un week-end entre amis et vous avez trouvé un "
               "chalet à louer à la montagne. Vous leur écrivez pour le "
               "présenter (emplacement, prix, équipements, activités à "
               "proximité) et vous leur proposez de réserver rapidement.",
     "tache2": "Vous venez de vous installer à l’étranger pour vos études. "
               "Vous écrivez à vos proches pour raconter vos premières "
               "semaines et ce qui vous plaît le plus dans cette nouvelle "
               "vie.",
     "tache3": {"title": "Les jeux vidéo : bons ou mauvais pour le cerveau ?",
                "doc_1": "Plusieurs études récentes montrent que certains "
                         "jeux vidéo stimulent la concentration, la mémoire "
                         "et la capacité à prendre rapidement des décisions. "
                         "Des jeux de stratégie ou de réflexion sont même "
                         "utilisés dans des programmes de rééducation. Joués "
                         "avec modération, ils peuvent donc constituer un "
                         "loisir enrichissant, pour les adultes comme pour "
                         "les plus jeunes.",
                "doc_2": "Des médecins alertent cependant sur les effets "
                         "d’une pratique excessive chez les adolescents : "
                         "troubles du sommeil, nervosité, isolement et "
                         "baisse des résultats scolaires. Certains jeunes "
                         "passent plusieurs heures par jour devant leur "
                         "console. Les spécialistes recommandent aux "
                         "familles de fixer des limites claires et de "
                         "privilégier d’autres activités."}},
    # Septembre 2026 · série 6 — série S6, d’après la Combinaison 4
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 6,
     "source": "d’après la Combinaison 4",
     "tache1": "Vous fêtez votre anniversaire dans une maison de campagne "
               "située à l’extérieur de la ville. Votre amie Sophie ne "
               "connaît pas l’endroit. Vous lui écrivez pour lui expliquer "
               "comment s’y rendre (adresse, itinéraire, transports, "
               "stationnement).",
     "tache2": "Sur un forum consacré aux langues, vous partagez votre "
               "expérience d’apprentissage du français : les difficultés "
               "rencontrées, les méthodes qui vous ont aidé(e) et vos "
               "progrès.",
     "tache3": {"title": "Devenir chef : formation obligatoire ou passion suffisante ?",
                "doc_1": "Pour les professionnels de la restauration, la "
                         "cuisine est un métier qui s’apprend. Hygiène, "
                         "gestion des stocks, techniques de découpe et "
                         "organisation d’une brigade ne s’improvisent pas. "
                         "Une formation en école hôtelière et plusieurs "
                         "années d’expérience en cuisine restent, selon eux, "
                         "le meilleur chemin vers la réussite.",
                "doc_2": "Pourtant, de nombreux cuisiniers amateurs ont "
                         "réussi sans diplôme. Grâce aux vidéos en ligne, "
                         "aux concours télévisés et aux réseaux sociaux, "
                         "certains passionnés ont ouvert leur propre "
                         "restaurant ou publié des livres de recettes à "
                         "succès. Leur parcours montre que la créativité et "
                         "la persévérance comptent autant que les diplômes."}},
    # Septembre 2026 · série 7 — série S7, d’après la Combinaison 3
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 7,
     "source": "d’après la Combinaison 3",
     "tache1": "Votre cousin Marc vient visiter votre ville pendant trois "
               "jours. Vous lui écrivez pour lui expliquer comment se "
               "déplacer (transports en commun, vélos en libre-service, "
               "taxis, tarifs et horaires).",
     "tache2": "Les habitants de votre immeuble ont organisé un repas entre "
               "voisins. Sur votre blog, vous racontez cet événement et vous "
               "expliquez ce que vous avez apprécié.",
     "tache3": {"title": "Snacks et sodas à l’école : interdire ou éduquer ?",
                "doc_1": "Pour certains parents, les distributeurs de "
                         "boissons et de snacks rendent service aux élèves "
                         "qui ont de longues journées ou qui n’ont pas le "
                         "temps de déjeuner. Ils estiment qu’il suffit de "
                         "proposer des produits plus sains, comme de l’eau, "
                         "des fruits secs ou des compotes, pour concilier "
                         "praticité et bonne alimentation.",
                "doc_2": "Des nutritionnistes, eux, demandent la suppression "
                         "pure et simple de ces machines. Selon eux, elles "
                         "encouragent le grignotage et la consommation de "
                         "sucre, en lien avec l’augmentation du surpoids "
                         "chez les adolescents. L’école, disent-ils, doit "
                         "montrer l’exemple et transmettre de bonnes "
                         "habitudes alimentaires."}},
    # Septembre 2026 · série 8 — série S8, d’après la Combinaison 2
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 8,
     "source": "d’après la Combinaison 2",
     "tache1": "« Coucou ! Pas de souci, je m’occupe de ton chat et de tes "
               "plantes pendant tes vacances. Qu’est-ce que je dois faire "
               "exactement ? Bises, Léa » — Vous répondez à Léa en lui "
               "donnant des instructions précises.",
     "tache2": "Vous avez passé une semaine dans un hôtel qui ne "
               "correspondait pas du tout à la description du site (chambre, "
               "propreté, services). Vous écrivez une lettre de réclamation "
               "à la direction de l’hôtel et vous demandez un dédommagement.",
     "tache3": {"title": "La restauration rapide : à éviter ou à consommer avec modération ?",
                "doc_1": "Julien : « Je ne mange presque jamais dans les "
                         "chaînes de restauration rapide. Les plats sont "
                         "trop gras, trop salés et souvent pauvres en "
                         "vitamines. On les choisit parce que c’est rapide "
                         "et pas cher, mais à long terme, notre santé en "
                         "paie le prix. Je préfère préparer mes repas à "
                         "l’avance. »",
                "doc_2": "Amina : « Je pense qu’on exagère les risques. "
                         "Aujourd’hui, ces restaurants proposent des "
                         "salades, des wraps et des fruits. Tout dépend de "
                         "ce qu’on commande et de la fréquence. Pour une "
                         "sortie entre amis ou un repas rapide entre deux "
                         "rendez-vous, c’est pratique, propre et accessible "
                         "à tous. »"}},
    # Septembre 2026 · série 9 — série S9, d’après la Combinaison 1
    {"month": "2026-09", "month_label": "Septembre 2026", "index": 9,
     "source": "d’après la Combinaison 1",
     "tache1": "Vous écrivez à un(e) ami(e) pour lui raconter le week-end "
               "que vous avez passé au bord de la mer, en détaillant ce que "
               "vous avez fait.",
     "tache2": "Vous êtes chargé(e) d’organiser la sortie annuelle de votre "
               "entreprise. Vous écrivez à votre directeur/directrice pour "
               "présenter le lieu choisi (adresse, activités, prix, "
               "transport) et lui demander son accord.",
     "tache3": {"title": "Les écrans à l’école : progrès ou danger ?",
                "doc_1": "Karim : « Les tablettes et les ordinateurs rendent "
                         "les cours plus vivants. Les élèves peuvent "
                         "regarder des vidéos, faire des exercices "
                         "interactifs et avancer à leur rythme. Dans un "
                         "monde où presque tous les métiers utilisent le "
                         "numérique, l’école doit préparer les jeunes à ces "
                         "outils. »",
                "doc_2": "Claire : « Les enfants passent déjà beaucoup trop "
                         "de temps devant les écrans à la maison. À l’école, "
                         "ils ont besoin d’écrire à la main, de lire des "
                         "livres et d’échanger avec leur enseignant et leurs "
                         "camarades. Selon moi, la technologie ne remplace "
                         "pas une vraie relation pédagogique. »"}},
    # Août 2026 · série 1 — série A1, d’après la Combinaison 1
    {"month": "2026-08", "month_label": "Août 2026", "index": 1,
     "source": "d’après la Combinaison 1",
     "tache1": "Votre ami Thomas est invité à la fête de fiançailles que "
               "vous organisez dans une salle de réception à la campagne, "
               "mais il ne sait pas où elle se trouve. Vous lui écrivez pour "
               "lui indiquer l’emplacement et les moyens d’y accéder.",
     "tache2": "Sur un blog, vous racontez votre premier mois dans un cours "
               "intensif de langue étrangère : vos impressions, vos "
               "difficultés et ce que vous avez le plus apprécié.",
     "tache3": {"title": "Apprendre à cuisiner : à l’école ou sur Internet ?",
                "doc_1": "Les écoles de cuisine offrent un cadre rigoureux : "
                         "les élèves apprennent les bases avec des chefs "
                         "expérimentés, pratiquent tous les jours et "
                         "obtiennent un diplôme reconnu par les employeurs. "
                         "Pour exercer en restaurant, ce parcours reste le "
                         "plus sûr.",
                "doc_2": "De plus en plus de passionnés apprennent grâce aux "
                         "tutoriels en ligne, gratuits et accessibles à "
                         "toute heure. Certains ont ensuite lancé leur "
                         "propre activité de traiteur ou leur chaîne de "
                         "recettes, prouvant qu’on peut réussir sans passer "
                         "par une formation classique."}},
    # Août 2026 · série 2 — série A2, d’après la Combinaison 2
    {"month": "2026-08", "month_label": "Août 2026", "index": 2,
     "source": "d’après la Combinaison 2",
     "tache1": "Vous écrivez à un(e) ami(e) pour lui raconter la randonnée "
               "en montagne que vous avez faite le week-end dernier, en "
               "détaillant les moments importants.",
     "tache2": "Votre équipe a trouvé un restaurant pour le dîner de fin "
               "d’année. Vous écrivez à la direction pour présenter ce lieu "
               "(adresse, menu, prix, capacité, services) et demander la "
               "validation de la réservation.",
     "tache3": {"title": "Des tablettes en classe dès l’école primaire ?",
                "doc_1": "Sarah, enseignante : « Depuis que mes élèves "
                         "utilisent des tablettes, ils sont plus motivés. "
                         "Les applications éducatives s’adaptent au niveau "
                         "de chacun et me permettent de suivre leurs "
                         "progrès. Le numérique est un outil formidable s’il "
                         "est bien encadré. »",
                "doc_2": "Paul, parent d’élève : « À sept ou huit ans, un "
                         "enfant doit apprendre à écrire, à se concentrer et "
                         "à jouer avec les autres. Les tablettes risquent de "
                         "le rendre dépendant aux écrans et de réduire les "
                         "échanges en classe. Je préfère les méthodes "
                         "traditionnelles. »"}},
    # Août 2026 · série 3 — série A3, d’après la Combinaison 3
    {"month": "2026-08", "month_label": "Août 2026", "index": 3,
     "source": "d’après la Combinaison 3",
     "tache1": "Un magazine de santé demande à ses lecteurs comment ils "
               "restent en forme. Vous envoyez votre témoignage : quelles "
               "activités sportives vous pratiquez, à quelle fréquence et ce "
               "qu’elles vous apportent.",
     "tache2": "Vous avez passé vos vacances dans une région de votre pays "
               "que vous ne connaissiez pas. Vous écrivez à vos amis pour "
               "raconter ce séjour et expliquer pourquoi il vous a beaucoup "
               "plu.",
     "tache3": {"title": "École privée ou école publique ?",
                "doc_1": "Chaque année, davantage de familles inscrivent "
                         "leurs enfants dans des établissements privés. "
                         "Elles mettent en avant des classes moins chargées, "
                         "un suivi plus personnalisé et une discipline plus "
                         "stricte. Pour ces parents, payer des frais de "
                         "scolarité est un investissement pour l’avenir de "
                         "leurs enfants.",
                "doc_2": "Des sociologues regrettent cette tendance. Selon "
                         "eux, l’école privée, payante, accueille surtout "
                         "des élèves issus de milieux aisés. Les enfants se "
                         "côtoient donc moins entre classes sociales, ce qui "
                         "renforce les inégalités. Ils rappellent que "
                         "l’école publique, gratuite, a pour mission de "
                         "réunir tous les enfants."}},
    # Août 2026 · série 4 — série A4, d’après la Combinaison 4
    {"month": "2026-08", "month_label": "Août 2026", "index": 4,
     "source": "d’après la Combinaison 4",
     "tache1": "Un(e) collègue étranger(ère) arrive dans votre ville pour un "
               "stage d’un mois. Vous lui écrivez pour lui expliquer comment "
               "aller de l’aéroport au centre-ville et comment se déplacer "
               "ensuite (bus, métro, vélo, abonnements).",
     "tache2": "Votre quartier a organisé un vide-grenier entre habitants. "
               "Sur votre blog, vous racontez cette journée et vous "
               "expliquez pourquoi vous avez aimé y participer.",
     "tache3": {"title": "Faut-il supprimer les distributeurs automatiques dans les lycées ?",
                "doc_1": "Pour la direction de certains lycées, les "
                         "distributeurs répondent à un vrai besoin : les "
                         "élèves ont parfois des cours jusqu’en fin de "
                         "journée et n’ont pas toujours accès à la cantine. "
                         "Avec des produits soigneusement choisis, comme "
                         "l’eau ou les jus sans sucre ajouté, ces machines "
                         "peuvent rester utiles.",
                "doc_2": "Des associations de parents réclament leur "
                         "suppression. Elles estiment que la majorité des "
                         "produits vendus restent trop sucrés ou trop gras "
                         "et favorisent l’obésité. Selon elles, l’argent "
                         "consacré aux distributeurs devrait plutôt servir à "
                         "améliorer les repas de la cantine."}},
    # Juillet 2026 · série 1 — série J1, d’après la Combinaison 5
    {"month": "2026-07", "month_label": "Juillet 2026", "index": 1,
     "source": "d’après la Combinaison 5",
     "tache1": "Vous organisez un pique-nique de fin d’année scolaire avec "
               "vos amis. Vous leur écrivez pour les inviter (date, lieu, "
               "programme, ce que chacun doit apporter).",
     "tache2": "Vous avez fait un voyage au Canada organisé par une agence. "
               "Sur le site de l’agence, vous laissez un commentaire "
               "détaillé sur votre expérience (hébergement, guide, "
               "activités, organisation).",
     "tache3": {"title": "Un centre-ville sans voitures : bonne ou mauvaise idée ?",
                "doc_1": "Plusieurs grandes villes européennes ont fermé "
                         "leur centre à la circulation automobile. Les "
                         "résultats sont encourageants : l’air est plus pur, "
                         "le bruit diminue et les rues sont plus sûres pour "
                         "les piétons et les cyclistes. Les commerces "
                         "profitent aussi d’une clientèle qui flâne "
                         "davantage.",
                "doc_2": "Cette mesure pose toutefois des difficultés "
                         "pratiques. Sans transports en commun efficaces ni "
                         "parkings à l’entrée de la ville, les habitants de "
                         "banlieue ont du mal à se rendre au centre. Les "
                         "livreurs, les artisans et les personnes âgées ou à "
                         "mobilité réduite sont particulièrement pénalisés."}},
    # Juillet 2026 · série 2 — série J2, d’après la Combinaison 4
    {"month": "2026-07", "month_label": "Juillet 2026", "index": 2,
     "source": "d’après la Combinaison 4",
     "tache1": "« Salut ! J’aimerais apprendre à nager cet été. Tu connais "
               "une bonne piscine près de chez toi ? Merci ! Julien » — Vous "
               "répondez à Julien en lui présentant une piscine que vous "
               "connaissez (adresse, horaires, cours proposés, prix).",
     "tache2": "Un magazine organise un concours : « Racontez la plus belle "
               "célébration de votre vie ». Vous participez en racontant "
               "comment cet événement s’est déroulé (mariage, fête "
               "traditionnelle, anniversaire, etc.) et ce que vous en gardez "
               "en mémoire.",
     "tache3": {"title": "Comment donner aux enfants le goût de la lecture ?",
                "doc_1": "Pour de nombreux enseignants, imposer des livres "
                         "aux enfants produit souvent l’effet inverse : la "
                         "lecture devient une corvée. Il vaut mieux laisser "
                         "l’enfant choisir ses lectures, même des bandes "
                         "dessinées ou des magazines, afin qu’il associe les "
                         "livres au plaisir plutôt qu’à l’obligation.",
                "doc_2": "Des orthophonistes rappellent que l’habitude de "
                         "lire se construit dès le plus jeune âge. Lire une "
                         "histoire chaque soir à son enfant enrichit son "
                         "vocabulaire, améliore sa concentration et crée un "
                         "moment de complicité. Quelques minutes par jour "
                         "suffisent, à condition d’être réguliers."}},
    # Juillet 2026 · série 3 — série J3, d’après la Combinaison 3
    {"month": "2026-07", "month_label": "Juillet 2026", "index": 3,
     "source": "d’après la Combinaison 3",
     "tache1": "Un(e) ami(e) étranger(ère) souhaite passer ses vacances dans "
               "votre pays. Vous lui écrivez pour lui présenter votre pays : "
               "traditions, spécialités culinaires et lieux incontournables "
               "à visiter.",
     "tache2": "Vous avez commencé un stage dans une entreprise. Vous "
               "écrivez un courriel à un(e) ami(e) pour lui raconter votre "
               "première semaine (entreprise, collègues, missions, "
               "impressions).",
     "tache3": {"title": "Égalité femmes-hommes au travail : objectif atteint ?",
                "doc_1": "Dans de nombreux pays, les femmes occupent "
                         "aujourd’hui des postes de direction, deviennent "
                         "ingénieures, pilotes ou cheffes d’entreprise. Les "
                         "lois sur l’égalité salariale et l’évolution des "
                         "mentalités ont ouvert presque tous les métiers aux "
                         "femmes. Pour beaucoup, l’égalité professionnelle "
                         "est désormais une réalité.",
                "doc_2": "Les statistiques montrent pourtant que des écarts "
                         "persistent : à poste égal, les femmes sont souvent "
                         "moins bien payées, et elles restent minoritaires "
                         "dans les conseils d’administration. Certains "
                         "métiers, comme ceux de la petite enfance, restent "
                         "presque exclusivement féminins. Les stéréotypes "
                         "ont encore la vie dure."}},
    # Juillet 2026 · série 4 — série J4, d’après la Combinaison 2
    {"month": "2026-07", "month_label": "Juillet 2026", "index": 4,
     "source": "d’après la Combinaison 2",
     "tache1": "Vous écrivez à un(e) ami(e) pour lui raconter le week-end "
               "que vous avez passé dans un camping au bord d’un lac, en "
               "détaillant ce qui s’est passé.",
     "tache2": "Votre service doit organiser son séminaire annuel. Vous "
               "écrivez à la direction pour présenter un lieu que vous avez "
               "trouvé (emplacement, salles, hébergement, repas, tarifs).",
     "tache3": {"title": "Cours en ligne ou cours en présentiel ?",
                "doc_1": "Lucas, étudiant : « Les cours en ligne me "
                         "permettent d’étudier quand je veux et où je veux. "
                         "Je peux revoir les vidéos autant de fois que "
                         "nécessaire et concilier mes études avec un travail "
                         "à temps partiel. Pour moi, c’est l’avenir de "
                         "l’enseignement. »",
                "doc_2": "Nadia, professeure : « Rien ne remplace la "
                         "présence en classe. Les étudiants posent plus "
                         "facilement des questions, travaillent en groupe et "
                         "restent motivés. À distance, beaucoup se sentent "
                         "isolés et abandonnent en cours d’année. »"}},
    # Juillet 2026 · série 5 — série J5, d’après la Combinaison 1
    {"month": "2026-07", "month_label": "Juillet 2026", "index": 5,
     "source": "d’après la Combinaison 1",
     "tache1": "Une radio locale prépare une émission sur le sport amateur "
               "et demande des témoignages à ses auditeurs. Vous envoyez un "
               "message pour expliquer quelle place le sport occupe dans "
               "votre vie.",
     "tache2": "Vous avez passé un week-end dans une ville historique de "
               "votre pays. Vous écrivez à vos amis pour raconter votre "
               "séjour et dire pourquoi il vous a plu.",
     "tache3": {"title": "Faut-il payer pour une meilleure école ?",
                "doc_1": "Pour beaucoup de parents, l’école privée offre un "
                         "meilleur encadrement : enseignants disponibles, "
                         "classes plus petites et suivi régulier des "
                         "résultats. Ils considèrent que l’éducation de "
                         "leurs enfants mérite cet effort financier, surtout "
                         "dans les quartiers où les écoles publiques sont "
                         "surchargées.",
                "doc_2": "D’autres estiment que l’éducation ne devrait pas "
                         "dépendre des moyens des familles. Les frais de "
                         "scolarité excluent une grande partie des élèves et "
                         "séparent les enfants selon leur origine sociale. "
                         "Ils préféreraient que l’État investisse davantage "
                         "pour que toutes les écoles publiques offrent la "
                         "même qualité d’enseignement."}},
]
