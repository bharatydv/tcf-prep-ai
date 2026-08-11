"""Coherent exam sets — the three tâches a candidate meets in one sitting.

The simulator used to draw one prompt per tâche at random, which produced
sittings no real paper would ever hand out. A set here is fixed and ordered, so
"set 7" means the same three tâches every time and a learner can compare two
attempts at it.

SPEAKING_EXAM_SETS entries are (tache1, tache2, tache3):
  tache1 — the guided interview brief; the candidate speaks about themselves.
  tache2 — {"theme", "situation", "hints"} : the roleplay the candidate leads.
  tache3 — {"theme", "question"} : the opinion the candidate defends.
"""

SPEAKING_EXAM_SETS = [
    # 01
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Immigration et Intégration",
      "situation": "Vous voulez vous inscrire à un programme de parrainage de bénévoles locaux pour vous aider à vous installer. Vous interrogez l'agent d'un centre d'accueil pour nouveaux arrivants.",
      "hints": "critères d'éligibilité, durée de l'accompagnement, activités proposées, etc."},
     {"theme": "Monde du Travail et Économie",
      "question": "L'automatisation et l'intelligence artificielle vont-elles détruire plus d'emplois qu'elles n'en créent ?"}),
    # 02
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Environnement et Transition Écologique",
      "situation": "Vous voulez installer des panneaux solaires sur le toit de votre maison. Vous interrogez un technicien spécialisé sur le coût, les subventions et les délais de pose.",
      "hints": "prix de l'installation, aides financières, rendement énergétique, etc."},
     {"theme": "Éducation et Jeunesse",
      "question": "Le système de notation traditionnel par notes chiffrées nuit-il à la motivation des élèves ?"}),
    # 03
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Monde du Travail et Économie",
      "situation": "Vous voyez une offre de stage en marketing au sein d'une start-up locale. Vous appelez le recruteur pour obtenir des précisions sur le poste.",
      "hints": "missions confiées, montant de l'indemnité, perspectives d'embauche, etc."},
     {"theme": "Voyages, Tourisme et Transport",
      "question": "Le surtourisme dégrade-t-il irréversiblement les sites classés au patrimoine mondial ?"}),
    # 04
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Éducation et Jeunesse",
      "situation": "Vous souhaitez inscrire votre enfant à des cours de soutien scolaire en mathématiques. Vous interrogez le directeur d'une agence de tutorat à domicile.",
      "hints": "tarifs horaires, profil des tuteurs, suivi pédagogique, etc."},
     {"theme": "Nouvelles Technologies et Réseaux Sociaux",
      "question": "Les réseaux sociaux représentent-ils un grave danger pour la santé mentale des jeunes ?"}),
    # 05
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Nouvelles Technologies et Réseaux Sociaux",
      "situation": "Vous rencontrez un problème avec votre nouvel abonnement à la fibre internet. Vous appelez le service technique de votre opérateur pour obtenir une assistance immédiate.",
      "hints": "délais de dépannage, nature de la panne, dédommagement prévu, etc."},
     {"theme": "Culture, Langue et Patrimoine",
      "question": "L'omniprésence de la langue anglaise menace-t-elle la diversité culturelle et linguistique mondiale ?"}),
    # 06
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Voyages, Tourisme et Transport",
      "situation": "Vous visitez une ville et cherchez une visite guidée historique à pied. Vous demandez les horaires, les tarifs et les langues parlées à l'agent de l'Office de Tourisme.",
      "hints": "point de départ, durée du parcours, réservation obligatoire, etc."},
     {"theme": "Santé, Sport et Bien-être",
      "question": "Les sportifs professionnels de haut niveau gagnent-ils trop d'argent par rapport à leur utilité sociale ?"}),
    # 07
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Société et Consommation",
      "situation": "Vous avez acheté un appareil électroménager qui est tombé en panne après seulement deux semaines d'utilisation. Vous retournez au magasin pour demander un échange ou un remboursement sous garantie.",
      "hints": "ticket de caisse, délais de réparation, modèle de remplacement, etc."},
     {"theme": "Immigration et Intégration",
      "question": "Le concept du multiculturalisme favorise-t-il la cohésion ou la division sociale ?"}),
    # 08
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Culture, Langue et Patrimoine",
      "situation": "Vous souhaitez organiser une visite privée d'un musée d'art pour un groupe d'étudiants. Vous interrogez le responsable des réservations du musée sur les tarifs et la présence d'un guide.",
      "hints": "taille maximale du groupe, durée de la visite, gratuité enseignants, etc."},
     {"theme": "Environnement et Transition Écologique",
      "question": "La responsabilité de la crise climatique repose-t-elle sur le consommateur ou sur les industries ?"}),
    # 09
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Santé, Sport et Bien-être",
      "situation": "Vous souhaitez vous inscrire à un club de randonnée en montagne. Vous demandez au guide de l'association quels équipements techniques (chaussures, bâtons) sont obligatoires.",
      "hints": "difficulté des parcours, covoiturage organisé, certificat médical, etc."},
     {"theme": "Société et Consommation",
      "question": "Le minimalisme matériel permet-il d'atteindre une forme de liberté et de bonheur réel ?"}),
    # 10
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Vie Sociale, Famille et Démographie",
      "situation": "Vous cherchez une baby-sitter de confiance pour garder vos enfants en soirée de manière régulière. Vous passez un entretien à une étudiante pour vérifier son expérience.",
      "hints": "tarif horaire demandé, aides aux devoirs, références à fournir, etc."},
     {"theme": "Monde du Travail et Économie",
      "question": "La semaine de travail de quatre jours augmente-t-elle la productivité des entreprises ?"}),
    # 11
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Immigration et Intégration",
      "situation": "Vous souhaitez participer à un atelier de préparation aux entretiens d'embauche au Canada. Vous demandez les détails d'organisation à l'organisateur.",
      "hints": "dates disponibles, documents à apporter, profil des formateurs, etc."},
     {"theme": "Nouvelles Technologies et Réseaux Sociaux",
      "question": "Les algorithmes de recommandation limitent-ils notre ouverture culturelle et notre curiosité ?"}),
    # 12
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Environnement et Transition Écologique",
      "situation": "Vous voulez remplacer votre ancienne chaudière par un système de chauffage écologique. Vous posez vos questions à un conseiller en énergie.",
      "hints": "crédits d'impôt, économies réalisées, durée des travaux, etc."},
     {"theme": "Culture, Langue et Patrimoine",
      "question": "La gastronomie locale fait-elle partie intégrante de l'identité nationale d'un peuple ?"}),
    # 13
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Monde du Travail et Économie",
      "situation": "Vous souhaitez négocier une formule de télétravail hybride avec votre employeur. Vous demandez un entretien avec votre manager pour poser vos conditions.",
      "hints": "nombre de jours, matériel fourni, horaires de présence, etc."},
     {"theme": "Vie Sociale, Famille et Démographie",
      "question": "Le modèle de la famille nucléaire traditionnelle est-il devenu obsolète dans nos sociétés contemporaines ?"}),
    # 14
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Éducation et Jeunesse",
      "situation": "Vous voulez obtenir des informations sur le programme d'échange universitaire Erasmus ou international. Vous posez vos questions au bureau des relations internationales de la faculté.",
      "hints": "bourses d'études, pays partenaires, niveau de langue requis, etc."},
     {"theme": "Santé, Sport et Bien-être",
      "question": "Le burn-out (épuisement professionnel) doit-il être reconnu d'office comme une maladie professionnelle ?"}),
    # 15
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Nouvelles Technologies et Réseaux Sociaux",
      "situation": "Vous êtes intéressé(e) par l'achat d'un ordinateur portable d'occasion reconditionné. Vous demandez au vendeur des détails sur l'état de la batterie et les logiciels inclus.",
      "hints": "durée de la garantie, prix d'origine, accessoires fournis, etc."},
     {"theme": "Voyages, Tourisme et Transport",
      "question": "Voyager seul est-ce le meilleur moyen d'apprendre à mieux se connaître ?"}),
    # 16
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Voyages, Tourisme et Transport",
      "situation": "Vous souhaitez louer un camping-car pour vos prochaines vacances en famille. Vous demandez au loueur des précisions sur le permis requis et les assurances incluses.",
      "hints": "montant de la caution, kilométrage autorisé, équipements de cuisine, etc."},
     {"theme": "Éducation et Jeunesse",
      "question": "Les années sabbatiques avant l'entrée à l'université : perte de temps ou gain d'autonomie ?"}),
    # 17
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Société et Consommation",
      "situation": "Vous constatez une erreur importante sur votre dernière facture d'électricité. Vous appelez le service client du fournisseur d'énergie pour contester le montant et demander une régularisation.",
      "hints": "relevé de compteur, délais d'étude, mode de remboursement, etc."},
     {"theme": "Environnement et Transition Écologique",
      "question": "Le développement de l'énergie nucléaire reste-t-il indispensable pour atteindre la neutralité carbone ?"}),
    # 18
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Culture, Langue et Patrimoine",
      "situation": "Vous souhaitez participer à un club de lecture mensuel organisé dans une librairie indépendante. Vous interrogez le libraire sur la liste des prochains livres à lire.",
      "hints": "horaires des rencontres, thèmes littéraires, participation financière, etc."},
     {"theme": "Immigration et Intégration",
      "question": "Faut-il vivre dans un pays pour en comprendre réellement la culture ?"}),
    # 19
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Santé, Sport et Bien-être",
      "situation": "Vous cherchez un entraîneur personnel (coach sportif) à domicile pour vous remettre en forme après une blessure. Vous l'interrogez sur ses diplômes et sa méthode de réadaptation.",
      "hints": "tarifs à l'heure, matériel apporté, fréquence conseillée, etc."},
     {"theme": "Société et Consommation",
      "question": "Les commerces de proximité traditionnels peuvent-ils survivre face aux géants du e-commerce ?"}),
    # 20
    ("Présentation du candidat — introduction personnelle.",
     {"theme": "Vie Sociale, Famille et Démographie",
      "situation": "Vous souhaitez devenir bénévole dans une association de parrainage de jeunes en difficulté scolaire. Vous interrogez le coordinateur sur le temps hebdomadaire nécessaire.",
      "hints": "formations initiales, profil des enfants, réunions d'équipe, etc."},
     {"theme": "Monde du Travail et Économie",
      "question": "L'importance grandissante des « soft skills » (compétences douces) face aux compétences techniques."}),
]


T3_QUESTION = "Comparez les deux points de vue et donnez votre opinion."

# WRITING_EXAM_SETS entries are (tache1, tache2, {doc_1, doc_2}).
# Transcribed as supplied. Tâche 1 and tâche 2 are worded as briefs rather than
# as "écrivez…" consignes; they are kept verbatim on the author's instruction,
# and the page states the format and word range for each tâche beside them.
WRITING_EXAM_SETS = [
    ("Personal background, family, studies/work and current situation.",
     "Vous souhaitez vous inscrire à une activité sportive dans votre quartier. Vous téléphonez au centre sportif pour obtenir des informations sur les activités proposées, les horaires, les tarifs, l'inscription et le matériel nécessaire.",
     {"doc_1": "De plus en plus d'entreprises permettent à leurs employés de travailler depuis chez eux. Pour beaucoup de salariés, cette organisation améliore considérablement la qualité de vie. Ils n'ont plus besoin de passer plusieurs heures dans les transports et peuvent consacrer davantage de temps à leur famille ou à leurs activités personnelles. Le télétravail permet également de travailler dans un environnement plus calme et d'organiser sa journée avec davantage de liberté. Selon certains employés, ils sont même plus concentrés et plus efficaces lorsqu'ils travaillent à distance.",
      "doc_2": "Même si le télétravail présente certains avantages, il ne convient pas à tout le monde. Les employés peuvent se sentir isolés lorsqu'ils passent plusieurs jours seuls chez eux. Les échanges avec les collègues sont également moins spontanés et certains problèmes sont plus difficiles à résoudre à distance. De plus, certaines personnes ont du mal à séparer leur vie professionnelle de leur vie privée et continuent à travailler après leurs horaires habituels. Pour ces raisons, le travail au bureau reste important pour maintenir une bonne communication et une véritable cohésion d'équipe."}),

    ("Daily routine, habits, free time and interests.",
     "Vous avez trouvé une annonce pour un appartement à louer. Vous contactez le propriétaire pour obtenir des informations sur le logement, le loyer, les charges, le quartier, les conditions de location et la disponibilité.",
     {"doc_1": "Les jeunes devraient pouvoir rester chez leurs parents pendant plusieurs années après leurs études. Dans de nombreuses villes, le prix des logements est devenu très élevé et il est difficile pour un jeune de payer seul un loyer. Rester en famille permet d'économiser de l'argent et de préparer plus facilement son avenir. Les jeunes peuvent également participer aux dépenses de la maison et aider leurs parents. Pour certaines familles, cette organisation permet donc aux jeunes de devenir financièrement indépendants progressivement, sans subir une pression excessive.",
      "doc_2": "D'autres personnes pensent qu'un jeune adulte devrait quitter le domicile familial lorsqu'il commence à travailler. Vivre seul permet d'apprendre à gérer un budget, payer ses factures et organiser son quotidien. Cela permet également de prendre ses propres décisions et de développer sa responsabilité. Rester trop longtemps chez ses parents peut parfois retarder cette indépendance et créer des habitudes difficiles à changer. Selon cette opinion, les jeunes devraient donc essayer de construire leur propre vie dès qu'ils disposent de revenus suffisants."}),

    ("Studies, professional experience, plans and future goals.",
     "Votre ami vous recommande un voyage dans une région que vous ne connaissez pas. Vous souhaitez préparer votre séjour et lui posez des questions sur les lieux à visiter, les transports, le logement, les activités et le budget.",
     {"doc_1": "Les réseaux sociaux ont profondément changé notre manière de communiquer. Ils permettent de rester facilement en contact avec des amis ou des membres de la famille qui vivent loin. Ils donnent également accès à des informations, à des événements et à des communautés qui partagent les mêmes intérêts. Pour certaines personnes, ces plateformes sont devenues un moyen important de développer leur vie sociale et même de découvrir de nouvelles opportunités professionnelles. Elles peuvent donc être utiles lorsqu'elles sont utilisées de manière raisonnable.",
      "doc_2": "Les réseaux sociaux peuvent également avoir des effets négatifs sur la vie quotidienne. Certaines personnes passent plusieurs heures par jour à consulter leur téléphone et deviennent dépendantes des réactions des autres. Les plateformes peuvent aussi diffuser rapidement de fausses informations et créer une pression sociale importante. Les utilisateurs comparent parfois leur vie à des images idéalisées publiées par d'autres personnes. Il est donc nécessaire de limiter son utilisation et de rester critique face aux contenus que l'on voit en ligne."}),

    ("Hobbies, leisure activities, weekends and social life.",
     "Vous souhaitez participer à un événement culturel organisé dans votre ville. Vous contactez l'organisateur pour demander des renseignements sur la date, le programme, les horaires, le prix, le lieu et les conditions de participation.",
     {"doc_1": "Les entreprises devraient davantage se préoccuper du bien-être de leurs employés. Une bonne ambiance, la reconnaissance du travail effectué et des possibilités d'évolution peuvent améliorer la motivation. Les salariés qui se sentent respectés sont souvent plus engagés et restent plus longtemps dans l'entreprise. Pour cette raison, investir dans le bien-être peut être bénéfique non seulement pour les employés mais également pour les résultats de l'entreprise. Une entreprise qui prend soin de son personnel peut donc aussi améliorer sa productivité.",
      "doc_2": "D'autres personnes pensent que le bonheur au travail relève principalement de la responsabilité individuelle. Une entreprise peut offrir de bonnes conditions, mais elle ne peut pas contrôler toutes les attentes et les difficultés personnelles d'un employé. Chaque salarié doit également apprendre à gérer son stress, communiquer avec ses collègues et trouver un équilibre entre son travail et sa vie privée. L'entreprise doit donc créer de bonnes conditions, mais chacun doit aussi prendre sa part de responsabilité."}),

    ("Personal experiences, memorable events and travel.",
     "Vous souhaitez suivre un cours de langue. Vous contactez une école pour vous renseigner sur les niveaux, les horaires, les tarifs, la durée des cours, le nombre d'étudiants et les modalités d'inscription.",
     {"doc_1": "Les gouvernements devraient investir davantage dans les transports publics. Des bus et des trains fréquents et fiables peuvent encourager les habitants à laisser leur voiture chez eux. Cela permettrait de réduire les embouteillages et la pollution dans les grandes villes. Des transports accessibles sont également importants pour les personnes qui n'ont pas de voiture. Pour améliorer la qualité de vie urbaine, il faudrait donc développer les réseaux et augmenter leur fréquence.",
      "doc_2": "Investir davantage dans les transports publics ne garantit pas que les habitants abandonneront leur voiture. Dans certaines régions, les distances sont trop importantes et les transports collectifs ne peuvent pas répondre aux besoins de tous. Les nouvelles infrastructures coûtent également très cher aux collectivités. Selon certains habitants, il serait plus efficace de développer plusieurs solutions en même temps, notamment les routes, les pistes cyclables et les transports publics."}),

    ("Lifestyle, daily habits, food, leisure and personal preferences.",
     "Vous cherchez un emploi et vous avez vu une annonce intéressante. Vous contactez l'entreprise pour obtenir des informations sur le poste, les horaires, les responsabilités, le salaire et les conditions de travail.",
     {"doc_1": "Pour beaucoup de personnes, acheter un logement représente un investissement important pour l'avenir. Une fois le crédit immobilier remboursé, le propriétaire possède un bien qui peut prendre de la valeur. Il n'a également plus de loyer à payer et peut modifier son logement comme il le souhaite. Pour les personnes qui disposent d'une situation financière stable et qui souhaitent rester longtemps dans la même ville, acheter peut donc offrir davantage de sécurité et de stabilité.",
      "doc_2": "Louer un logement présente cependant plusieurs avantages. Le locataire peut changer facilement de ville ou de logement lorsqu'il change de travail ou de situation personnelle. Il n'a pas non plus à payer les grosses réparations ou certains frais liés à la propriété. Acheter demande en effet un apport important et représente un engagement financier sur plusieurs années. Pour les personnes qui recherchent de la flexibilité, la location peut donc être une solution plus adaptée."}),

    ("Education, work experience, skills and ambitions.",
     "Vous souhaitez organiser une fête pour plusieurs amis dans un restaurant. Vous contactez le restaurant pour demander des informations sur le menu, les prix, les horaires, les réservations et les possibilités d'organisation.",
     {"doc_1": "Les enfants devraient avoir moins accès aux écrans. Une utilisation excessive des téléphones, tablettes et ordinateurs peut réduire le temps consacré au sport, au sommeil et aux relations familiales. Certains enfants passent également plusieurs heures à regarder des vidéos ou à jouer au lieu de pratiquer des activités créatives. Pour cette raison, les parents devraient fixer des limites claires et encourager leurs enfants à pratiquer davantage d'activités physiques et sociales.",
      "doc_2": "Les écrans peuvent également avoir une fonction éducative lorsqu'ils sont utilisés correctement. Les enfants peuvent regarder des documentaires, apprendre une langue ou utiliser des applications éducatives. Les outils numériques font aussi partie de la vie professionnelle moderne et les jeunes doivent apprendre à les utiliser. Selon certains parents, il ne faut donc pas interdire les écrans, mais apprendre aux enfants à les utiliser de manière raisonnable et responsable."}),

    ("Family, relationships, free time and social activities.",
     "Vous voulez faire une excursion pendant le week-end. Vous contactez une agence touristique pour obtenir des informations sur les destinations, le transport, les activités, les repas, les prix et les horaires.",
     {"doc_1": "Lorsqu'une personne choisit un emploi, le salaire reste un élément essentiel. Un bon revenu permet de payer facilement les dépenses quotidiennes, d'épargner pour l'avenir et de réaliser certains projets personnels. Dans une période où le coût de la vie augmente, il est normal de rechercher une situation financière stable. Pour certaines personnes, accepter un emploi mieux payé peut également permettre de soutenir leur famille ou d'améliorer leur logement. Le salaire représente donc une motivation importante lorsqu'on choisit un travail.",
      "doc_2": "Un salaire élevé ne garantit pas nécessairement le bonheur professionnel. Une personne peut gagner beaucoup d'argent tout en étant stressée, fatiguée ou insatisfaite de ses tâches. L'ambiance de travail, les horaires, les relations avec les collègues et les possibilités d'évolution sont également importantes. Certains salariés préfèrent gagner un peu moins mais avoir davantage de temps libre et exercer un métier qui les intéresse. Selon eux, le salaire doit donc être considéré comme un élément parmi d'autres lorsqu'on évalue la qualité d'un emploi."}),

    ("Personal interests, sports, hobbies and healthy habits.",
     "Vous avez besoin de meubles pour votre nouveau logement. Vous contactez un magasin pour vous renseigner sur les produits disponibles, les prix, la livraison, les délais et les conditions de paiement.",
     {"doc_1": "Les grandes villes offrent de nombreuses possibilités aux habitants. Elles disposent généralement de davantage de transports publics, de services médicaux, d'universités, de magasins et d'activités culturelles. Les habitants peuvent également rencontrer des personnes venant de milieux et de cultures différents. Pour les jeunes qui cherchent des études ou des possibilités professionnelles, une grande ville peut donc être particulièrement attractive et dynamique.",
      "doc_2": "La vie dans une petite ville présente également de nombreux avantages. Les habitants peuvent profiter d'un environnement plus calme, de moins de circulation et parfois d'un coût de logement moins élevé. Les relations entre voisins peuvent être plus proches et l'accès à la nature est souvent plus facile. Pour les personnes qui recherchent une vie moins stressante, une petite ville peut donc offrir une meilleure qualité de vie qu'une grande métropole."}),

    ("Current life, work/studies, responsibilities and future plans.",
     "Vous souhaitez participer à une activité bénévole dans votre ville. Vous contactez une association pour demander des informations sur les missions, les horaires, les conditions de participation et les compétences nécessaires.",
     {"doc_1": "Le tourisme culturel permet aux visiteurs de découvrir l'histoire, les traditions et le patrimoine d'une région. Il peut également créer des emplois et apporter des revenus aux habitants. Lorsque les touristes visitent des musées, des monuments ou des villages historiques, ils contribuent à leur entretien. Pour cette raison, le développement du tourisme culturel peut être bénéfique à la fois pour les visiteurs et pour les communautés locales. Il permet aussi de mieux faire connaître une culture à l'étranger.",
      "doc_2": "Un nombre trop important de touristes peut cependant endommager les lieux historiques et modifier la vie des habitants. Certains sites deviennent très fréquentés et les prix des logements peuvent augmenter dans les quartiers touristiques. Les traditions locales risquent également d'être transformées uniquement pour répondre aux attentes des visiteurs. Selon cette opinion, les autorités devraient donc limiter le nombre de touristes dans les endroits les plus fragiles et mieux contrôler le développement touristique."}),

    ("Daily life, leisure, friends and personal preferences.",
     "Vous souhaitez acheter un billet pour un spectacle. Vous contactez la salle pour demander des informations sur les dates, les horaires, les tarifs, les places disponibles et les conditions de réservation.",
     {"doc_1": "Les horaires flexibles permettent aux employés de mieux adapter leur journée à leurs besoins personnels. Une personne peut commencer plus tôt pour aller chercher ses enfants à l'école ou commencer plus tard après un rendez-vous important. Cette liberté peut réduire le stress et améliorer l'équilibre entre la vie professionnelle et la vie familiale. Les employés peuvent également choisir les heures où ils sont les plus efficaces. Pour de nombreuses entreprises, offrir davantage de flexibilité est donc une manière d'améliorer la satisfaction et la motivation des salariés.",
      "doc_2": "Les horaires flexibles peuvent cependant compliquer le travail en équipe. Si chacun commence et termine à une heure différente, il devient plus difficile de trouver un moment pour organiser une réunion ou résoudre rapidement un problème. Les clients peuvent également avoir du mal à savoir quand contacter certains employés. Dans certaines entreprises, des horaires communs sont donc nécessaires pour garantir une bonne organisation. La flexibilité devrait être adaptée au type de travail et ne devrait pas être considérée comme une solution universelle."}),

    ("Studies/work, achievements, difficulties and future projects.",
     "Vous cherchez une activité pour votre enfant pendant les vacances. Vous contactez un centre de loisirs pour obtenir des informations sur les activités, les horaires, les tarifs, les repas, la sécurité et l'inscription.",
     {"doc_1": "Pour beaucoup de jeunes, l'université reste la meilleure voie pour construire une carrière. Un diplôme supérieur permet d'accéder à certaines professions et offre des connaissances spécialisées. Les études universitaires permettent également de rencontrer d'autres étudiants et de développer un réseau professionnel. Pour les métiers qui demandent des qualifications précises, l'université reste donc indispensable. Certaines entreprises considèrent également le diplôme comme une preuve de sérieux et de motivation.",
      "doc_2": "Cependant, réussir sa vie professionnelle ne dépend pas toujours d'un diplôme universitaire. Certaines personnes préfèrent suivre une formation professionnelle, créer une entreprise ou apprendre directement grâce à leur expérience. Dans plusieurs secteurs, les employeurs recherchent surtout des compétences pratiques et la capacité à résoudre des problèmes. Pour ces personnes, passer plusieurs années à l'université n'est donc pas forcément la meilleure solution. Une formation courte peut parfois permettre d'entrer plus rapidement dans la vie professionnelle."}),

    ("Travel experiences, holidays, memorable moments and future travel plans.",
     "Vous souhaitez organiser une sortie avec vos collègues. Vous contactez un lieu de loisirs pour demander des renseignements sur les activités disponibles, les tarifs de groupe, les horaires, la réservation et les services proposés.",
     {"doc_1": "L'intelligence artificielle peut rendre la vie quotidienne plus simple. Elle permet de trouver rapidement des informations, de traduire des textes, d'organiser certaines tâches et d'obtenir de l'aide pour résoudre des problèmes. Dans le monde professionnel, elle peut également effectuer des tâches répétitives et permettre aux employés de gagner du temps. Pour ses défenseurs, cette technologie peut donc améliorer la productivité et laisser davantage de temps aux activités qui nécessitent de la créativité ou des relations humaines.",
      "doc_2": "L'intelligence artificielle présente cependant certains risques. Les utilisateurs peuvent devenir trop dépendants des outils numériques et perdre certaines compétences. Les informations fournies par une intelligence artificielle peuvent également être incorrectes. Dans le monde professionnel, certaines personnes craignent aussi que des emplois soient remplacés par des machines. Selon cette opinion, la technologie peut être utile, mais elle doit être utilisée avec prudence et ne doit pas remplacer complètement les compétences humaines."}),

    ("Personal habits, health, exercise and lifestyle.",
     "Vous venez d'arriver dans une nouvelle ville et vous cherchez un médecin. Vous contactez un cabinet pour obtenir des informations sur les horaires, les rendez-vous, les tarifs, les documents nécessaires et les possibilités de consultation.",
     {"doc_1": "Les gouvernements devraient investir davantage dans la prévention des problèmes de santé. Informer la population sur l'alimentation, le sport et certaines habitudes dangereuses peut permettre d'éviter des maladies. Les campagnes de prévention peuvent également réduire les dépenses médicales à long terme. Pour cette raison, il serait plus efficace d'apprendre aux citoyens à protéger leur santé avant qu'un problème apparaisse plutôt que de se concentrer uniquement sur les traitements.",
      "doc_2": "Les campagnes de prévention ne garantissent cependant pas que les citoyens changeront leurs habitudes. Beaucoup de personnes connaissent déjà les risques liés au tabac, à l'alcool ou à une mauvaise alimentation mais continuent malgré tout. Certains pensent donc que les gouvernements devraient surtout améliorer l'accès aux soins et laisser les individus décider eux-mêmes de leur mode de vie. Selon eux, l'information est utile, mais chacun doit rester responsable de ses choix."}),

    ("Family life, childhood memories, traditions and personal experiences.",
     "Vous souhaitez acheter un ordinateur pour vos études ou votre travail. Vous contactez un magasin pour demander des informations sur les modèles, les prix, les caractéristiques, la garantie et les modalités de paiement.",
     {"doc_1": "Les petits commerces jouent un rôle important dans la vie d'un quartier. Ils permettent aux clients de bénéficier d'un service plus personnalisé et de recevoir des conseils directement auprès des commerçants. Acheter localement contribue également à maintenir des emplois et une activité économique dans la région. Pour cette raison, certains consommateurs préfèrent payer un peu plus cher dans les petits magasins afin de soutenir les commerces de proximité.",
      "doc_2": "Les supermarchés restent cependant plus pratiques pour de nombreuses familles. Ils proposent un grand choix de produits au même endroit et offrent souvent des prix plus bas grâce à leur taille. Les clients peuvent également faire toutes leurs courses en une seule fois, ce qui leur fait gagner du temps. Pour les familles qui doivent respecter un budget limité, les supermarchés représentent donc une solution difficile à remplacer."}),

    ("Professional life, workplace, colleagues and career plans.",
     "Vous souhaitez louer une voiture pour quelques jours. Vous contactez une agence pour obtenir des informations sur les modèles, les tarifs, l'assurance, les conditions de location et les documents nécessaires.",
     {"doc_1": "Les adultes devraient pratiquer une activité physique régulièrement. Avec les emplois de bureau et les longues heures passées devant les écrans, de nombreuses personnes bougent beaucoup moins qu'avant. Le sport permet de maintenir une bonne condition physique et peut également réduire le stress. Même une activité simple comme la marche ou le vélo peut avoir des effets positifs. Les adultes devraient donc considérer l'activité physique comme une partie normale de leur routine.",
      "doc_2": "Tout le monde n'a cependant pas le temps ou l'envie de pratiquer un sport organisé. Les personnes qui travaillent beaucoup ou qui ont de jeunes enfants peuvent difficilement aller à la salle plusieurs fois par semaine. Elles peuvent néanmoins rester actives en marchant davantage, en prenant les escaliers ou en faisant des activités quotidiennes. Selon cette opinion, il n'est donc pas nécessaire de suivre un programme sportif strict pour rester en bonne santé. L'essentiel est de bouger régulièrement."}),

    ("Free time, entertainment, culture and social activities.",
     "Vous souhaitez rejoindre une bibliothèque de votre quartier. Vous contactez la bibliothèque pour demander des informations sur l'inscription, les horaires, les services disponibles, les activités et les conditions de prêt.",
     {"doc_1": "Les cours en ligne rendent l'éducation accessible à un grand nombre de personnes. Un étudiant peut suivre une formation depuis chez lui, même s'il habite loin d'une école ou d'une université. Il peut également regarder certaines leçons plusieurs fois et organiser son travail selon son propre rythme. Cette solution est particulièrement intéressante pour les adultes qui travaillent ou pour les personnes qui ont des difficultés à se déplacer. Elle offre donc une grande flexibilité.",
      "doc_2": "Malgré ces avantages, les cours en présentiel restent importants. Les étudiants peuvent poser directement leurs questions au professeur et participer à des discussions avec leurs camarades. La présence physique aide également certaines personnes à rester concentrées et motivées. À la maison, les étudiants peuvent facilement être distraits par leur téléphone, leur famille ou les tâches quotidiennes. Pour cette raison, les cours traditionnels restent plus efficaces pour beaucoup d'élèves."}),

    ("Personal development, skills, goals and future plans.",
     "Vous souhaitez participer à un festival dans une autre ville. Vous contactez l'organisateur pour demander des informations sur le programme, les billets, les transports, le logement et les activités proposées.",
     {"doc_1": "Les relations sociales sont importantes pour le bien-être et la qualité de vie. Certaines personnes aiment avoir beaucoup d'amis et apprécient de rencontrer régulièrement de nouvelles personnes. Un cercle social large permet de découvrir différents points de vue, de participer à davantage d'activités et de créer de nouvelles opportunités. Pour les personnes qui aiment communiquer, avoir de nombreux amis peut donc être une véritable source d'énergie et de soutien.",
      "doc_2": "D'autres personnes préfèrent avoir seulement quelques amis proches. Elles considèrent que la qualité d'une relation est plus importante que le nombre de personnes que l'on connaît. Avec quelques amis, il est possible de construire une relation fondée sur la confiance et de recevoir un véritable soutien dans les moments difficiles. Selon cette opinion, avoir trop de relations superficielles peut prendre beaucoup de temps sans apporter la même satisfaction."}),

    ("Daily routine, food, shopping, hobbies and lifestyle.",
     "Vous cherchez un logement dans un nouveau quartier. Vous contactez une agence immobilière pour demander des informations sur les logements disponibles, les prix, les transports, les commerces et les conditions de location.",
     {"doc_1": "Les entreprises devraient accorder davantage d'importance au bien-être de leurs employés. Des horaires raisonnables, des congés suffisants et un environnement de travail agréable peuvent réduire le stress et améliorer la motivation. Un employé qui se sent bien dans son entreprise peut également être plus engagé et plus fidèle. Pour cette raison, investir dans le bien-être du personnel peut finalement être bénéfique pour la productivité et les résultats de l'entreprise.",
      "doc_2": "La productivité reste cependant essentielle au fonctionnement d'une entreprise. Une société doit atteindre ses objectifs et rester compétitive pour pouvoir conserver ses emplois. Certaines mesures de bien-être peuvent être utiles, mais elles ne doivent pas empêcher les salariés d'accomplir leurs responsabilités. Selon cette opinion, il faut surtout trouver un équilibre entre les conditions de travail et les objectifs économiques de l'entreprise."}),

    ("Life experiences, studies/work, interests and future ambitions.",
     "Vous souhaitez organiser une activité pour votre anniversaire avec plusieurs amis. Vous contactez un centre de loisirs pour obtenir des informations sur les activités, les prix, les horaires, la réservation et les possibilités pour les groupes.",
     {"doc_1": "Vivre à l'étranger peut être une expérience extrêmement enrichissante. Une personne découvre une nouvelle culture, apprend à communiquer avec des personnes différentes et doit souvent devenir plus autonome. Cette expérience peut également améliorer les compétences linguistiques et professionnelles. Pour les jeunes notamment, vivre dans un autre pays permet de sortir de ses habitudes et de mieux comprendre différentes manières de vivre. Pour ces raisons, beaucoup considèrent cette expérience comme une excellente occasion de développement personnel.",
      "doc_2": "Vivre à l'étranger n'est cependant pas forcément positif pour tout le monde. Certaines personnes peuvent souffrir de l'éloignement de leur famille et avoir des difficultés à s'adapter à une nouvelle culture. Les démarches administratives, la recherche d'un logement et les différences linguistiques peuvent également créer beaucoup de stress. Pour certaines personnes, il est donc préférable de voyager régulièrement sans nécessairement s'installer dans un autre pays. Une expérience à l'étranger doit avant tout correspondre à la personnalité et à la situation de chacun."}),
]


def writing_set(number: int) -> dict:
    """One numbered writing sitting, shaped for the simulator.

    task3 carries its two documents separately from the question, so the page
    can lay them out as the paper does and the word counter never mistakes the
    documents for the candidate's own text.
    """
    t1, t2, t3 = WRITING_EXAM_SETS[number - 1]
    return {
        "set_number": number,
        "task1": {"task_type": 1, "text": t1},
        "task2": {"task_type": 2, "text": t2},
        "task3": {"task_type": 3, "text": T3_QUESTION,
                  "doc_1": t3["doc_1"], "doc_2": t3["doc_2"]},
    }


def speaking_set(number: int) -> dict:
    """One numbered sitting, shaped for the API."""
    t1, t2, t3 = SPEAKING_EXAM_SETS[number - 1]
    return {
        "set_number": number,
        "task1": {"task_type": 1, "brief": t1},
        "task2": {"task_type": 2, "theme": t2["theme"],
                  "situation": t2["situation"], "hints": t2["hints"],
                  # What the roleplay agent is handed as the scenario.
                  "consigne": f"{t2['situation']} ({t2['hints']})"},
        "task3": {"task_type": 3, "theme": t3["theme"],
                  "question": t3["question"]},
    }


def validate() -> list:
    """Problems with the bank, empty when it is well formed."""
    problems = []
    for i, entry in enumerate(WRITING_EXAM_SETS, start=1):
        if len(entry) != 3:
            problems.append(f"writing set {i}: expected 3 tâches")
            continue
        t1, t2, t3 = entry
        if not str(t1).strip():
            problems.append(f"writing set {i}: tâche 1 is empty")
        if not str(t2).strip():
            problems.append(f"writing set {i}: tâche 2 is empty")
        for field in ("doc_1", "doc_2"):
            if not str(t3.get(field, "")).strip():
                problems.append(f"writing set {i}: tâche 3 missing {field}")
        # The two documents must genuinely oppose, not repeat: identical text
        # would leave nothing to compare, which is the whole task.
        if t3.get("doc_1") == t3.get("doc_2"):
            problems.append(f"writing set {i}: tâche 3 documents are identical")
    for i, entry in enumerate(SPEAKING_EXAM_SETS, start=1):
        if len(entry) != 3:
            problems.append(f"speaking set {i}: expected 3 tâches")
            continue
        t1, t2, t3 = entry
        if not str(t1).strip():
            problems.append(f"speaking set {i}: tâche 1 brief is empty")
        for field in ("theme", "situation", "hints"):
            if not str(t2.get(field, "")).strip():
                problems.append(f"speaking set {i}: tâche 2 missing {field}")
        for field in ("theme", "question"):
            if not str(t3.get(field, "")).strip():
                problems.append(f"speaking set {i}: tâche 3 missing {field}")
    return problems
