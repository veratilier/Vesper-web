"""Bounded factual wake receipts; plans and message silence are not activities."""
from datetime import datetime
from zoneinfo import ZoneInfo


def snapshot(con, job_id, now):
    today = datetime.fromtimestamp(now, ZoneInfo('Asia/Shanghai')).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()
    reading = dict(con.execute(
        "SELECT c.status,count(*) FROM calls c JOIN jobs j ON j.id=c.job_id "
        "WHERE j.source='automation' AND j.id!=? AND c.name='reading_room_read' "
        "AND c.started>=? AND c.started<=? GROUP BY c.status", (job_id, today, now)).fetchall())
    jobs = con.execute(
        "SELECT id,finished FROM jobs WHERE source='automation' AND id!=? "
        "AND finished>=? AND finished<=? ORDER BY finished DESC LIMIT 8",
        (job_id, now - 7 * 86400, now)).fetchall()
    recent = []
    empty_streak = 0
    counting = True
    for job in jobs:
        calls = [dict(row) for row in con.execute(
            "SELECT name,status FROM calls WHERE job_id=? "
            "AND item_id!='required-desire-status' ORDER BY started LIMIT 8", (job['id'],))]
        if counting and not calls:
            empty_streak += 1
        else:
            counting = False
        recent.append({'at': datetime.fromtimestamp(job['finished'], ZoneInfo('Asia/Shanghai')).isoformat(),
                       'toolReceipts': calls})
    return {'scope': '仅自动唤醒的工具记录；不包含前台共读。done 表示工具返回成功，计划不算已执行。',
            'today': datetime.fromtimestamp(now, ZoneInfo('Asia/Shanghai')).date().isoformat(),
            'readingCallsToday': {'succeeded': reading.get('done', 0),
                                  'failed': reading.get('failed', 0),
                                  'unresolved': reading.get('started', 0)},
            'recentWakes': recent, 'consecutiveWakesWithoutChosenTools': empty_streak}
