"""Where a learner's recording may be read from, and what it is called.

A recording of somebody's voice is served by path out of the database, so the
one thing worth pinning without a database is that no path can reach outside
the tree it belongs to — and that the tree is not the public media mount.
"""
import os

import server as m


class TestRecordingFile:
    def test_resolves_a_normal_path_inside_the_tree(self):
        got = m.recording_file("speaking/user_abc/sub_1.webm")
        assert got
        assert got.startswith(os.path.realpath(m.RECORDINGS_ROOT) + os.sep)

    def test_refuses_to_climb_out_of_the_tree(self):
        assert m.recording_file("../../.env") == ""
        assert m.recording_file("speaking/../../../etc/passwd") == ""

    def test_refuses_an_absolute_path(self):
        assert m.recording_file("/etc/passwd") == ""
        assert m.recording_file(r"C:\Windows\win.ini") == ""

    def test_refuses_an_empty_path(self):
        # An empty audio_path is every submission recorded before this existed.
        assert m.recording_file("") == ""

    def test_recordings_are_not_served_from_the_public_media_tree(self):
        # /media is a static mount in development and a PUBLIC bucket in
        # production. Voice recordings must not resolve into it.
        recordings = os.path.realpath(m.RECORDINGS_ROOT)
        media = os.path.realpath(m.MEDIA_ROOT)
        assert not recordings.startswith(media + os.sep)
        assert recordings != media

    def test_no_recording_path_is_reachable_through_media_url(self):
        # media_url() is the public URL builder; nothing here should use it.
        assert "recordings" not in m.media_url("speaking/user_abc/sub_1.webm")


class TestAudioExtensions:
    def test_every_accepted_upload_type_has_a_filename_extension(self):
        # A download with no extension opens in nothing on Windows.
        for mime in m._ALLOWED_AUDIO_MIME:
            assert m._AUDIO_EXT_BY_MIME.get(mime), mime

    def test_an_unknown_type_still_gets_a_usable_one(self):
        assert m._AUDIO_EXT_BY_MIME.get("audio/weird", "webm") == "webm"
