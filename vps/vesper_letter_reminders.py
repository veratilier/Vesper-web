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
            if letter.get('deliveredAt'):continue
            ident = key(actor, letter)
            if actor == 'Rowan':
                # One durable wake request per cover. Never join an unrelated job:
                # its completion must not discard a letter reminder. Quiet hours,
                # disabled wakes, presence and tool permissions remain enforced.
                now = time.time()
                with store.db() as con:
                    con.execute("INSERT OR IGNORE INTO jobs(id,source,due,status,created) VALUES(?,'automation',?,'queued',?)", (ident,now,now))
            else:
                target = policy.target(policy.history(history))
                if not target:continue
                job = {**target, 'source':'letter-reminder'}
                # System reminder, not invented speech from Rowan; no letter body.
                title = letter.get('title') or '一封信'
                save_message(job,ident,'system','Rowan 给你的「' + title + '」现在可以拆信了。',
                             {'source':'letter-reminder','letterId':letter['id'],'blockType':'letterReminder'})
            # Safe to retry: both queue insert and history message use stable IDs.
            http('/api/letters/reminders?actor=' + actor, {'id':letter['id']})
