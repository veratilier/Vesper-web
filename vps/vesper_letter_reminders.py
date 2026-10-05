"""Durable cover-only reminders. Model reading still obeys the normal wake gates."""
import hashlib
import json
import time
import vesper_wake_store as store
import vesper_wake_policy as policy


def key(actor, letter):
    return 'letter-' + hashlib.sha256((actor + ':' + letter['id']).encode()).hexdigest()[:40]


def pending(http, actor):
    return [r for r in http('/api/letters/reminders?actor=' + actor)['reminders'] if r.get('due')]


def context(http):
    try: covers = pending(http, 'Rowan')
    except Exception:
        # A reminder outage must not break ordinary wakes or imply no mail.
        return json.dumps({'available':False,'reason':'Letter reminders temporarily unavailable'})
    return json.dumps([{'id':r['id'],'title':r['title'],'author':r['author']} for r in covers], ensure_ascii=False)


def poll(http, history, save_message):
    for actor in ('Rowan', 'Vera'):
        for letter in pending(http, actor):
            if letter.get('deliveredAt') and actor == 'Vera':continue
            ident = key(actor, letter)
            target = policy.target(policy.history(history))
            if not target:continue
            job = {**target, 'source':'letter-reminder'}
            title = letter.get('title') or '一封信'
            content = ('Vera 给 Rowan 的「' if actor == 'Rowan' else 'Rowan 给你的「') + title + '」现在可以拆信了。'
            # Visible cover-only receipt, independent of whether background reading
            # is currently permitted. Stable ID prevents duplicate chat reminders.
            if not letter.get('deliveredAt'):
                save_message(job,ident,'system',content,
                             {'source':'letter-reminder','letterId':letter['id'],'recipient':actor,'blockType':'letterReminder'})
            if actor == 'Rowan':
                # One durable wake request per cover. Never join an unrelated job:
                # its completion must not discard a letter reminder. Quiet hours,
                # disabled wakes, presence and tool permissions remain enforced.
                now = time.time()
                with store.db() as con:
                    con.execute("INSERT OR IGNORE INTO jobs(id,source,due,status,created) VALUES(?,'letter-reminder',?,'queued',?)", (ident,now,now))
                    # Repair only known skips before any model started. Never replay
                    # an uncertain, failed or completed model/tool execution.
                    con.execute("""UPDATE jobs SET source='letter-reminder',status='queued',due=?,finished=NULL,scheduled_at=NULL,decision=NULL
                        WHERE id=? AND thread_id IS NULL AND tools=0 AND
                        ((status='silent' AND decision IN ('sleep_time','recent_user_activity')) OR
                         (status='cancelled' AND decision='disabled') OR (status='skipped' AND decision='no_eligible_target'))""",(now,ident))
            # Safe to retry: both queue insert and history message use stable IDs.
            if not letter.get('deliveredAt'):http('/api/letters/reminders?actor=' + actor, {'id':letter['id']})
