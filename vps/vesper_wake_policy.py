"""Read-only conversation eligibility and explicit, expiring wake preferences."""
import json, re, sqlite3
from datetime import datetime


def timestamp(value):
    try:return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    except (ValueError,AttributeError):return 0


def normal(row):
    meta=json.loads(row['metadata_json'] or '{}')
    return not (meta.get('wake') or meta.get('wakeRunId') or meta.get('test') or meta.get('isTest') or meta.get('verification') or meta.get('synthetic') or
        meta.get('source') in ('automation','verification','test') or meta.get('blockType') == 'execution' or
        row['vesper_conversation_id']=='vesper-autonomous-wake' or row['content'].strip()=='唤醒 AI' or re.match(r'^(?:\[test\]|\[测试\]|后台验证[:：]|测试消息[:：]|自动唤醒[:：])',row['content'].strip(),re.I))


def history(path):
    if not path.exists():return []
    with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as con:
        con.row_factory=sqlite3.Row
        return [dict(r) for r in con.execute("SELECT m.* FROM messages m JOIN conversations c ON c.vesper_conversation_id=m.vesper_conversation_id WHERE c.archived_at IS NULL ORDER BY m.created_at DESC")]


def target(rows):
    for user in rows:
        if not re.fullmatch(r'[a-zA-Z0-9:_-]{1,128}',user['vesper_conversation_id']):continue
        if user['role']!='user' or not normal(user) or not user['content'].strip():continue
        meta=json.loads(user['metadata_json'] or '{}')
        turn=user.get('turn_id') or meta.get('turnId')
        if not turn or (meta.get('turnStatus') or user['status'])!='completed':continue
        if any(a['role']=='agent' and normal(a) and a['content'].strip() and a.get('message_type','text')=='text' and
               json.loads(a['metadata_json'] or '{}').get('blockType','agentMessage')=='agentMessage' and
               a['vesper_conversation_id']==user['vesper_conversation_id'] and
               (a.get('turn_id') or json.loads(a['metadata_json'] or '{}').get('turnId'))==turn and
               a['status'] in ('completed','delivered') and
               json.loads(a['metadata_json'] or '{}').get('turnStatus','completed')=='completed' for a in rows):
            return {'conversation_id':user['vesper_conversation_id'],'user_message_id':user['id'],'user_turn_id':turn}
    return None


def preferences(rows,now):
    """Only unquoted direct first-person statements; no inference from silence or behavior."""
    result={}
    for row in reversed(rows):
        at=timestamp(row['created_at'])
        if row['role']!='user' or not normal(row) or not 0<=now-at<86400:continue
        text=row['content'].strip()
        if any(x in text for x in ('```','>','“','「','如果','比如','他说','她说','不要说','不是说','不想让','怎么','为什么')):continue
        duration=re.search(r'(\d+(?:\.\d+)?|半|两|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])\s*(?:个)?(小时|分钟|天)',text)
        def number(value):
            if value=='半':return .5
            digits={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
            if value in digits:return digits[value]
            if '十' in value:
                first,_,last=value.partition('十');return digits.get(first,1)*10+digits.get(last,0)
            return float(value)
        ttl=min(86400,number(duration[1])*{'小时':3600,'分钟':60,'天':86400}[duration[2]]) if duration else 21600
        if not duration and ('今天' in text or '今晚' in text):
            from zoneinfo import ZoneInfo
            from datetime import timedelta
            local=datetime.fromtimestamp(at,ZoneInfo('Asia/Singapore'))
            ttl=(local.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)).timestamp()-at
        if at+ttl<=now:continue
        evidence={'messageId':row['id'],'expiresAt':at+ttl}
        if re.search(r'别打扰我|不要打扰我|(?:先)?别找我|别联系我|让我安静|先别(?:给我)?发消息|不要主动(?:找我|发消息)|我想静静',text):
            result['quiet']=evidence
        elif re.search(r'现在可以(?:找我|发消息)|可以主动找我|不用保持安静',text):result.pop('quiet',None)
        if re.search(r'(?:少|减少)(?:一点)?(?:打扰|主动消息)|别太频繁',text):result['less']=evidence
        if re.search(r'我(?:现在|今天)?(?:很|有点|觉得)?(?:难过|开心|焦虑|疲惫|累|烦)',text):
            result['emotion']={**evidence,'statement':text[:160]}
    return result


def interval(longing,prefs,rng):
    center=120-.9*max(0,min(100,float(longing)))
    if prefs.get('less'):center=max(center,105)
    return round(rng.uniform(max(30,center-15),min(120,center+15))*60)
