import datetime as dt
import unittest

from scripts.update_schedule import parse_listing, select_latest


class ScheduleListingTests(unittest.TestCase):
    def test_selects_newest_modified_schedule_and_breaks_ties_by_name(self):
        listing = """
        <table>
          <tr><td><a class="file" href="RAN4_120bis_meeting_schedule_v02.pptx">RAN4_120bis_meeting_schedule_v02.pptx</a></td><td>2026/10/07 8:43</td><td>140 KB</td></tr>
          <tr><td><a class="file" href="RAN4_120bis_meeting_schedule_THU_morning.pptx">RAN4_120bis_meeting_schedule_THU_morning.pptx</a></td><td>2026/10/23 0:05</td><td>145 KB</td></tr>
          <tr><td><a class="file" href="RAN4_120bis_meeting_schedule_THU.pptx">RAN4_120bis_meeting_schedule_THU.pptx</a></td><td>2026/10/23 0:05</td><td>145 KB</td></tr>
          <tr><td><a class="file" href="RAN4_other_document.pptx">RAN4_other_document.pptx</a></td><td>2026/10/24 1:00</td><td>145 KB</td></tr>
        </table>
        """

        schedules = parse_listing(listing, "https://files.example/History/")
        latest = select_latest(schedules)

        self.assertEqual(latest["name"], "RAN4_120bis_meeting_schedule_THU_morning.pptx")
        self.assertEqual(latest["modified"], dt.datetime(2026, 10, 23, 0, 5))
        self.assertEqual(len(schedules), 3)

    def test_rejects_listing_without_schedules(self):
        with self.assertRaisesRegex(ValueError, "No RAN4 meeting schedule"):
            parse_listing('<table><tr><td>no schedule here</td></tr></table>')


if __name__ == "__main__":
    unittest.main()
