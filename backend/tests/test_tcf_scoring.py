"""The 699-point scale compréhension écrite and orale are actually marked on.

A reading or listening paper is not scored out of 39. The official TCF weights
every item by its difficulty — the four easiest are worth 3 points each, the
four hardest 33 — and a perfect paper is 699. The CLB level an immigration
file is read on comes off that scale, so a slip in this table is a slip in
every level this product reports for two of the four skills.

The published table, which these tests are the copy of:

    questions  1-4    3 pts     12
               5-10   9 pts     54
               11-19  15 pts   135
               20-29  21 pts   210
               30-35  26 pts   156
               36-39  33 pts   132
                               ---
                               699
"""
import server as m


class TestItemPoints:
    def test_every_band_boundary_is_where_the_paper_puts_it(self):
        for position, points in ((1, 3), (4, 3), (5, 9), (10, 9),
                                 (11, 15), (19, 15), (20, 21), (29, 21),
                                 (30, 26), (35, 26), (36, 33), (39, 33)):
            assert m.tcf_item_points(position) == points, position

    def test_the_bands_cover_the_whole_paper_and_total_699(self):
        assert sum(m.tcf_item_points(p) for p in range(1, 40)) == 699
        assert m.TCF_COMPREHENSION_TOTAL == 699

    def test_the_paper_is_thirty_nine_questions(self):
        counts = {}
        for p in range(1, 40):
            counts[m.tcf_item_points(p)] = counts.get(m.tcf_item_points(p), 0) + 1
        assert counts == {3: 4, 9: 6, 15: 9, 21: 10, 26: 6, 33: 4}

    def test_a_position_past_the_paper_is_still_weighed(self):
        # A bank that ever grew a 40th item must not score it as zero.
        assert m.tcf_item_points(40) == 33


class TestComprehensionScore:
    def _paper(self, correct_positions):
        return [{"position": p, "is_correct": p in correct_positions}
                for p in range(1, 40)]

    def test_a_perfect_paper_is_699(self):
        assert m.tcf_comprehension_score(self._paper(set(range(1, 40)))) == 699

    def test_an_empty_paper_is_nothing(self):
        assert m.tcf_comprehension_score(self._paper(set())) == 0

    def test_the_same_count_of_right_answers_is_not_the_same_score(self):
        """The whole reason the weighting exists.

        Ten easy questions and ten hard ones are '10/39' either way, and are
        not remotely the same performance.
        """
        easy = m.tcf_comprehension_score(self._paper(set(range(1, 11))))
        hard = m.tcf_comprehension_score(self._paper(set(range(30, 40))))
        assert easy == 12 + 54            # the whole A1 and A2 blocks
        assert hard == 156 + 132          # the whole C1 and C2 blocks
        assert hard > easy * 3

    def test_a_row_with_no_verdict_scores_nothing(self):
        assert m.tcf_comprehension_score([{"position": 39}]) == 0
