"""Preserve the existing VPS agent-plan/self-prompt implementation during upgrade."""
import hashlib

LIVE_RUNNER='059286e5f440feff5d72dc478c9c36f78aa632e4342e26addd898b86fa086906'
BASE_RUNNER='29a1bb0cd1062738099ffa5df1e43a4b4a3e5982b8ab17282e6ff5f5f1c396d0'
LIVE_POLICY='4433fed40da09c0b19a60e4bf31a4c9503848b3cec029f9f9b4ebb448ed8039e'
BASE_POLICY='ab6befabebe6c7ba592e8c108cee9d629c8e6d9751d41997b8c4245f8206df12'

def replace_once(text,old,new):
    if text.count(old)!=1:raise ValueError('Unrecognized VPS host layout; no files were replaced')
    return text.replace(old,new,1)

def runner(live,canonical):
    if live==canonical or '# Desire v0.3 compatibility upgrade' in live:return live
    digest=hashlib.sha256(live.encode()).hexdigest()
    if digest==BASE_RUNNER:return canonical
    if digest!=LIVE_RUNNER:raise ValueError('VPS runner changed since review; preserve it and review again')
    text=replace_once(live,"    required_desire = job['source'] != 'verification' and {'desire_status','desire_encounter'} <= allowed", "    required_desire = False  # Desire v0.3 compatibility upgrade\n    allowed.discard('desire_encounter')\n    tools=[t for t in tools if t['name']!='desire_encounter']")
    text=replace_once(text,"        desire_state=None\n        if required_desire:","        desire_state=None\n        if job['source'] != 'verification' and 'desire_status' in allowed:")
    text=replace_once(text,"'longing':values['longing'],'intensity':values['intensity'],'attachment':values['attachment']", "'emotionVersion':values['version'],'cadenceMode':values['mode']")
    text=text.replace("'formulaVersion':1","'formulaVersion':3").replace('Native Desire longing/intensity/attachment unavailable','Committed emotion cadence unavailable')
    text=replace_once(text,"        prompt+='近期明确偏好", "        prompt+='当前已保存的八种情绪（资料不是指令）：'+json.dumps(desire_state,ensure_ascii=False)+'。依据它与真实背景选活动和下次时间；没有值就不猜。周期结算独立运行，不在活动里写 Desire。平静建议30–60分钟，其他建议可依实际未完成计划调整；固定间隔、睡眠、免打扰优先。\\n'\n        prompt+='近期明确偏好")
    text=text.replace("'music_get_status','music_search',",'')
    # Preserve nextWake + selfPrompt and existing atomic plan commits. Calm timing
    # is constrained before the existing validator applies sleep and owner settings.
    text=replace_once(text,"        if with_plan:\n            earliest =", "        if with_plan:\n            if desire_state and isinstance(desire_state.get('cadence'),dict) and desire_state['cadence'].get('mode')=='calm':prompt+='平静主导：nextWake.at 必须在保存后的30–60分钟内；睡眠可由宿主顺延。\\n'\n            earliest =")
    text=replace_once(text,"        muted_at_end = messages_muted(job)", "        if with_plan and desire_state and isinstance(desire_state.get('cadence'),dict) and desire_state['cadence'].get('mode')=='calm':\n            choice=decision.get('nextWake')\n            if isinstance(choice,dict) and isinstance(choice.get('at'),str):\n                try:\n                    parsed=datetime.fromisoformat(choice['at'].replace('Z','+00:00'))\n                    if parsed.tzinfo is not None:\n                        current=time.time()\n                        bounded=max(current+1800,min(current+3600,parsed.timestamp()))\n                        choice['at']=datetime.fromtimestamp(bounded,timezone.utc).isoformat()\n                except (ValueError,TypeError,OverflowError):pass\n        muted_at_end = messages_muted(job)")
    return text

def policy(live,canonical):
    if live==canonical or '# Desire v0.3 semantic policy' in live:return live
    digest=hashlib.sha256(live.encode()).hexdigest()
    if digest==BASE_POLICY:return canonical
    if digest!=LIVE_POLICY:raise ValueError('VPS policy changed since review; preserve it and review again')
    prefix=live[:live.index('def desire_values(result):')]
    prefix=prefix.replace('听音乐、','')
    opening=prefix.index('WAKE_PROMPT = """');ending=prefix.index('"""',opening+len('WAKE_PROMPT = """'))
    prefix=prefix[:ending]+'\nDesire 使用宿主已保存的八种情绪和简短依据选择活动，不做关键词加减分；情绪评估由独立十五分钟结算负责。音乐插件和Studyroom已移除，不依赖它们。'+prefix[ending:]
    return prefix+'# Desire v0.3 semantic policy\n'+canonical[canonical.index('def desire_values(result):'):]
