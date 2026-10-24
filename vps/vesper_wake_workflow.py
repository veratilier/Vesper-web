"""Owner-visible execution facts, never raw tool payloads or private reasoning."""
ACTIONS = {
    'desire_status': '查看此刻的 Desire', 'desire_encounter': '保存此刻的心绪',
    'read_vesper_state': '读取 Vesper 内容', 'search_vesper_state': '查找 Vesper 内容',
    'letter_list': '翻阅信箱', 'letter_create': '寄出信件', 'letter_read': '拆开信件', 'letter_keep': '收好信件',
    'bookmark_list': '翻阅书签', 'bookmark_create': '保存图文书签',
    'reading_room_read': '阅读 Library', 'reading_room_annotate': '留下阅读批注',
    'write_vesper_state': '保存文字', 'recall_vesper_memory': '查找相关记忆',
    'remember_vesper_memory': '保存记忆', 'manage_vesper_memory': '查看记忆',
    'music_search': '搜索音乐', 'music_get_status': '查看音乐状态',
    'chat_search_messages': '查找旧聊天', 'chat_capture_messages': '保存聊天截图',
    'album_save_photo': '保存相册图片', 'album_search_photos': '查找相册图片',
    'browse_system_photos': '浏览 iPhone 相册预览', 'view_system_photo': '查看照片预览',
    'album_send_photos': '分享相册图片', 'send_chat_file': '分享文件',
    'sticker_search': '查找贴纸', 'sticker_send': '发送贴纸',
    'list_configured_mcp_tools': '查看已授权的论坛工具', 'call_configured_mcp_tool': '使用已授权的论坛工具',
}
REASONS = {
    'nothing_to_share': '这次没有合适的话要发，安静待了一会儿。',
    'recent_user_activity': '最近仍在聊天，留出空间。', 'sleep_time': '睡眠时间，保持静默。',
    'quiet_busy_or_target_removed': '聊天、免打扰或目标状态发生变化，停止本轮。',
    'no_authorized_tools': '当前没有已授权工具。', 'no_eligible_target': '暂时没有可用的聊天目标。',
    'disabled': '自唤醒已关闭。',
}

def step(name, args=None, result=None, failed=False, uncertain=False):
    args = args or {}
    action = ACTIONS.get(name, '执行已授权操作')
    if name == 'write_vesper_state':
        action = {'note': '留下一张便签', 'journal': '写入日记'}.get(args.get('kind'), action)
    value = {'action': action, 'completion': 'unknown' if uncertain else 'failed' if failed else 'request_accepted',
             'result': '结果未确认，未自动重试。' if uncertain else '操作未成功。' if failed else '接口已返回结果；不据此认定外部活动已完成。', 'references': []}
    if failed or uncertain or not isinstance(result, dict): return value
    # Only known, locally persisted receipts can be called complete.
    for key, kind in [('letter','letters'), ('bookmark','bookmarks')]:
        saved = result.get(key)
        if name == ('letter_create' if key == 'letter' else 'bookmark_create') and isinstance(saved, dict) and isinstance(saved.get('id'), str):
            title = saved.get('title') if key == 'letter' else ''
            label = ('《' + title[:80] + '》') if isinstance(title,str) and title.strip() else ''
            value.update(completion='completed', result=('已保存 Letters' + label + '。') if key == 'letter' else '已保存到书签。',
                         references=[{'kind': kind, 'id': saved['id'][:128]}])
    if name == 'write_vesper_state' and result.get('saved') is True:
        section = result.get('section')
        if section in {'notes','journal'}:
            value.update(completion='completed', result='已保存到便签。' if section == 'notes' else '已保存到日记。')
    if name in {'desire_status','read_vesper_state','search_vesper_state','letter_list','bookmark_list','reading_room_read','recall_vesper_memory','music_search','music_get_status','chat_search_messages','album_search_photos','browse_system_photos','view_system_photo','sticker_search','list_configured_mcp_tools'}:
        count = next((len(result[k]) for k in ('letters','bookmarks','matches','memories','tracks','photos','stickers','connections') if isinstance(result.get(k),list)), None)
        value.update(completion='completed', result=('读取完成，返回 ' + str(count) + ' 条结果。') if count is not None else '读取完成。')
    if name == 'desire_encounter': value.update(completion='completed', result='Desire 接口已确认本次评估。')
    if name == 'remember_vesper_memory' and result.get('stored') is True and (result.get('memory') or {}).get('kind') == 'dream':
        value.update(completion='completed', result='完整的梦已保存到 Dreams。')
    if name in {'letter_read','letter_keep'} and isinstance(result.get('letter'), dict):
        letter = result['letter']
        value.update(completion='completed', result='信件仍在封存，未返回正文。' if letter.get('locked') and name == 'letter_read' else '信件状态已确认。')
    return value


def describe(job, calls):
    if job.get('source') == 'morning-dream':
        status = job['status']
        outcome = ('running' if status in {'queued', 'running', 'saved'} else
                   'failure' if status == 'failed' else 'partial_failure' if status == 'push_failed' else
                   'silent' if status == 'silent' else 'success')
        return {'title': '晨间的梦', 'summary': '梦已保存，早安消息已写入聊天。' if job.get('notification') else
                '梦与早安消息正在准备。' if outcome == 'running' else '晨间梦未完成。',
                'outcome': outcome, 'silentReason': job.get('silent_reason') or ''}
    meaningful = [c for c in calls if c.get('name') not in {'desire_status','desire_encounter'}]
    actions = list(dict.fromkeys(c['action'] for c in meaningful))
    bad = any(c.get('status') in {'failed','started'} for c in calls)
    status = job['status']
    outcome = ('running' if status in {'queued','running','saved'} else
               'failure' if status == 'failed' else
               'interrupted' if status in {'cancelled','interrupted'} else
               'partial_failure' if bad else 'silent' if status == 'silent' else 'success')
    reason = REASONS.get(job.get('decision'), '本轮未发送聊天消息。') if not job.get('notification') else ''
    if status == 'failed':
        error = job.get('error') or ''
        reason = '本轮超过 token 预算，未完成最终决定。' if 'Wake token budget exceeded' in error else '本轮执行未完成；未作出保持安静的决定。'
    return {'title': ' · '.join(actions[:2]) or ('唤醒未完成' if status == 'failed' else '留一句话' if job.get('notification') else '安静醒来'),
            'summary': reason if status == 'failed' else '；'.join(c['result'] for c in meaningful[:3]) or ('已留下一条聊天消息。' if job.get('notification') else reason),
            'outcome': outcome, 'silentReason': job.get('silent_reason') or reason}
