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
