#!/usr/bin/env python3
"""Build a credential-free batch heart-rate shortcut; sign with Apple's CLI."""
import argparse
import pathlib
import plistlib
import uuid

OUT = pathlib.Path(__file__).resolve().parents[1] / 'artifacts' / 'shortcuts'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--smoke', action='store_true', help='Generate a fixture-only dictionary/Repeat with Each check')
args = parser.parse_args()
actions = []


def uid():
    return str(uuid.uuid4()).upper()


def attachment(value):
    return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}


def text(*parts):
    value, refs = '', {}
    for part in parts:
        if isinstance(part, dict):
            offset = len(value.encode('utf-16-le')) // 2
            refs[f'{{{offset}, 1}}'] = part
            value += '\ufffc'
        else:
            value += part
    return {'Value': {'string': value, 'attachmentsByRange': refs},
            'WFSerializationType': 'WFTextTokenString'}


def action(identifier, name=None, **params):
    ident = uid()
    params['UUID'] = ident
    if name:
        params['CustomOutputName'] = name
    actions.append({'WFWorkflowActionIdentifier': identifier if '.' in identifier else 'is.workflow.actions.' + identifier,
                    'WFWorkflowActionParameters': params})
    return {'Type': 'ActionOutput', 'OutputUUID': ident, 'OutputName': name or 'Result'}


def native(identifier, name=None, **params):
    # Built-in identifiers include their own namespace dots.
    return action('is.workflow.actions.' + identifier, name, **params)


def prop(ref, key, entity=False):
    aggrandizement = {'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': key}
    if entity:
        aggrandizement['PropertyUserInfo'] = {'WFLinkEntityContentPropertyUserInfoPropertyIdentifier': key}
    return {**ref, 'Aggrandizements': [aggrandizement]}


def fields(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFKey': text(key), 'WFItemType': 0,
         'WFValue': text(value) if isinstance(value, dict) else text(value)}
        for key, value in items.items()]}, 'WFSerializationType': 'WFDictionaryFieldValue'}


def combine(name, ref):
    return native('text.combine', name, text=attachment(ref), WFTextSeparator='New Lines')


def iso(ref, name):
    return native('format.date', name, WFDate=text(ref),
                  WFDateFormatStyle='Custom', WFDateFormat="yyyy-MM-dd'T'HH:mm:ssXXX",
                  WFISO8601IncludeTime=True)


def add_day(date, name):
    return native('adjustdate', name, WFDate=text(date), WFAdjustOperation='Add',
        WFDuration={'Value': {'Magnitude': '1', 'Unit': 'days'}, 'WFSerializationType': 'WFQuantityFieldValue'},
        WFAdjustOffsetPicker={'Value': {'Operation': 'Add', 'Unit': 'Day', 'Value': 1}, 'WFSerializationType': 'WFTimeOffsetValue'})


def named(name):
    return {'Type': 'Variable', 'VariableName': name}


def begin_if(ref, group, condition, **extra):
    native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(ref)},
           WFCondition=condition, WFControlFlowMode=0, GroupingIdentifier=group, **extra)


def otherwise(group):
    native('conditional', WFControlFlowMode=1, GroupingIdentifier=group)


def end_if(group):
    native('conditional', WFControlFlowMode=2, GroupingIdentifier=group)


def missing_guard(ref, group):
    begin_if(ref, group, 101)


def get_key(ref, key, name):
    return native('getvalueforkey', name, WFInput=attachment(ref),
                  WFDictionaryKey=key, WFGetDictionaryValueType='Value')


def number(ref, name):
    return native('number', name, WFNumberActionNumber=attachment(ref))


def init_list(name):
    empty = native('list', name + ' 初始列表', WFItems=[])
    native('setvariable', WFInput=attachment(empty), WFVariableName=name)


def append(name, value):
    item = value if isinstance(value, dict) else native('gettext', '临时文本值', WFTextActionText=value)
    native('appendvariable', WFInput=attachment(item), WFVariableName=name)


def mark_failure(response):
    append('批量失败响应', response)


def classify_import_response(response):
    """Count one successful save, an explicit server skip, or a malformed result."""
    stored = get_key(response, 'storedWorkouts', '保存训练数')
    missing_stored = uid()
    missing_guard(stored, missing_stored)
    mark_failure(response)
    otherwise(missing_stored)
    stored_number = number(stored, '保存训练数（数字）')
    is_saved = uid()
    # Condition 2 is greater than zero; native fixture checks both sides.
    begin_if(stored_number, is_saved, 2, WFNumberValue='0')
    append('已保存训练', response)
    otherwise(is_saved)
    skipped = get_key(response, 'skipped', '服务器跳过原因')
    missing_skip_reason = uid()
    missing_guard(skipped, missing_skip_reason)
    mark_failure(response)
    otherwise(missing_skip_reason)
    append('已跳过训练', response)
    end_if(missing_skip_reason)
    end_if(is_saved)
    end_if(missing_stored)


def import_workout(date, workout_id, dates, values, apple_ids, starts, ends):
    response_raw = native('downloadurl', '本条训练的服务器结果',
        WFURL=text(server, '/api/heart-rate/import'),
        WFHTTPMethod='POST', WFHTTPBodyType='JSON', ShowHeaders=True,
        WFHTTPHeaders=fields({'Authorization': credential}),
        WFJSONValues=fields({
            'batch': 'true', 'date': date, 'workout_id': workout_id,
            'dates': dates, 'values': values,
            'apple_workout_id': apple_ids, 'started_at': starts, 'ended_at': ends,
            'sync_workout_time': 'true'}))
    response = native('detect.dictionary', '解析本条服务器结果', WFInput=attachment(response_raw))
    classify_import_response(response)


if args.smoke:
    # Fixture-only actions exercise dictionary extraction, repeat flow, classification,
    # and empty list/count branches without Health, network, or credentials.
    fixture = native('gettext', '模拟待处理响应', WFTextActionText=(
        '{"workouts":[{"date":"2026-10-20","workout_id":"smoke-a"},'
        '{"date":"2026-10-21","workout_id":"smoke-b"}],'
        '"pending":2,"skippedAmbiguous":0}'))
    parsed = native('detect.dictionary', '解析模拟响应', WFInput=attachment(fixture))
    smoke_workouts = get_key(parsed, 'workouts', '模拟训练列表')
    init_list('循环结果')
    loop_id = uid()
    native('repeat.each', WFInput=attachment(smoke_workouts), WFControlFlowMode=0,
           GroupingIdentifier=loop_id)
    repeat_item = named('Repeat Item')
    item_date = get_key(repeat_item, 'date', '循环中的日期')
    item_id = get_key(repeat_item, 'workout_id', '循环中的训练 ID')
    line = native('gettext', '当前循环结果', WFTextActionText=text(item_date, ' / ', item_id))
    append('循环结果', line)
    native('repeat.each', WFControlFlowMode=2, GroupingIdentifier=loop_id)

    empty_pending_raw = native('gettext', '模拟零待处理响应', WFTextActionText=(
        '{"workouts":[],"pending":0,"skippedAmbiguous":0}'))
    empty_pending = native('detect.dictionary', '解析零待处理响应', WFInput=attachment(empty_pending_raw))
    empty_workouts = get_key(empty_pending, 'workouts', '空训练列表')
    empty_pending_count = native('count', '零待处理数量', Input=attachment(empty_workouts), WFCountType='Items')

    init_list('已保存训练')
    init_list('已跳过训练')
    init_list('批量失败响应')
    for label, payload in (
        ('模拟保存响应', '{"ok":true,"storedWorkouts":1}'),
        ('模拟跳过响应', '{"ok":true,"storedWorkouts":0,"skipped":"no_samples"}'),
        ('模拟错误响应', '{"error":"synthetic","code":"bad_response"}'),
    ):
        raw = native('gettext', label + '文本', WFTextActionText=payload)
        parsed_response = native('detect.dictionary', label, WFInput=attachment(raw))
        classify_import_response(parsed_response)

    empty_samples = native('list', '模拟空心率样本', WFItems=[])
    empty_sample_count = native('count', '零心率样本数量', Input=attachment(empty_samples), WFCountType='Items')
    empty_sample_count_number = number(empty_sample_count, '零心率样本数（数字）')
    init_list('本机验证问题')
    nonzero_empty_samples = uid()
    begin_if(empty_sample_count_number, nonzero_empty_samples, 2, WFNumberValue='0')
    append('本机验证问题', '空样本条件应走零分支')
    otherwise(nonzero_empty_samples)
    native('nothing')
    end_if(nonzero_empty_samples)

    loop_count = native('count', '循环次数', Input=attachment(named('循环结果')), WFCountType='Items')
    loop_count_number = number(loop_count, '循环次数（数字）')
    positive_loop_group = uid()
    begin_if(loop_count_number, positive_loop_group, 2, WFNumberValue='0')
    native('nothing')
    otherwise(positive_loop_group)
    append('本机验证问题', '正数循环计数未进入大于零分支')
    end_if(positive_loop_group)
    result_text = native('text.combine', '循环结果文本', text=attachment(named('循环结果')),
                         WFTextSeparator='New Lines')
    saved_smoke = native('count', '模拟保存计数', Input=attachment(named('已保存训练')), WFCountType='Items')
    skipped_smoke = native('count', '模拟跳过计数', Input=attachment(named('已跳过训练')), WFCountType='Items')
    failed_smoke = native('count', '模拟失败计数', Input=attachment(named('批量失败响应')), WFCountType='Items')
    smoke_issues = native('count', '本机验证问题数', Input=attachment(named('本机验证问题')), WFCountType='Items')
    native('gettext', 'Fixture smoke result', WFTextActionText=text('Fixture smoke: repeat items=', loop_count, '\n', result_text,
        '\nzero pending workouts=', empty_pending_count,
        '\nsaved=', saved_smoke, ' skipped=', skipped_smoke, ' failed=', failed_smoke,
        '\nempty-sample branch issues=', smoke_issues))
    workflow_name = 'OpenGym 批量快捷指令本机验证'
else:
    native('comment', WFCommentActionText=(
        'OpenGym 一键同步心率\n从已登录的 OpenGym 训练列表中，按日期顺序同步所有待处理训练。'
        '需要 Actions App 和 iPhone 健康数据权限。请从已登录网页启动，无需填写凭证。'))
    incoming = native('detect.dictionary', '网页同步参数', WFInput=attachment({'Type': 'ExtensionInput'}))
    server = native('getvalueforkey', '服务器地址', WFInput=attachment(incoming), WFDictionaryKey='server', WFGetDictionaryValueType='Value')
    credential = native('getvalueforkey', '本次同步授权', WFInput=attachment(incoming), WFDictionaryKey='authorization', WFGetDictionaryValueType='Value')
    missing = uid()
    native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(credential)}, WFCondition=101, WFControlFlowMode=0, GroupingIdentifier=missing)
    native('showresult', Text='请从已登录的 OpenGym 网页点击同步，无需填写凭证。')
    native('exit')
    native('conditional', WFControlFlowMode=2, GroupingIdentifier=missing)
    pending_raw = native('downloadurl', '待同步训练响应',
        WFURL=text(server, '/api/heart-rate/pending'),
        WFHTTPMethod='POST', WFHTTPBodyType='JSON', ShowHeaders=True,
        WFHTTPHeaders=fields({'Authorization': credential}), WFJSONValues=fields({}))
    pending_dict = native('detect.dictionary', '解析待同步训练响应', WFInput=attachment(pending_raw))
    workouts = get_key(pending_dict, 'workouts', '所有待处理训练')
    pending_count_value = get_key(pending_dict, 'pending', '待处理数量')
    ambiguous_value = get_key(pending_dict, 'skippedAmbiguous', '日期歧义数量')

    # Missing contract fields are shown once and stop before any item processing.
    missing_pending = uid()
    missing_guard(pending_count_value, missing_pending)
    native('showresult', Text=text('同步失败：待处理响应缺少 pending 数量。\n', pending_raw))
    native('exit')
    otherwise(missing_pending)
    missing_ambiguous = uid()
    missing_guard(ambiguous_value, missing_ambiguous)
    native('showresult', Text=text('同步失败：待处理响应缺少 skippedAmbiguous 数量。\n', pending_raw))
    native('exit')
    otherwise(missing_ambiguous)

    ambiguous_count = number(ambiguous_value, '日期歧义数量（数字）')
    init_list('已保存训练')
    init_list('已跳过训练')
    init_list('批量失败响应')

    pending_number = number(pending_count_value, '待处理数量（数字）')
    has_pending = uid()
    begin_if(pending_number, has_pending, 2, WFNumberValue='0')
    missing_workouts = uid()
    missing_guard(workouts, missing_workouts)
    native('showresult', Text=text('同步失败：pending 大于零，但响应缺少 workouts 列表。\n', pending_raw))
    native('exit')
    otherwise(missing_workouts)

    loop_id = uid()
    native('repeat.each', WFInput=attachment(workouts), WFControlFlowMode=0,
           GroupingIdentifier=loop_id)
    repeat_item = named('Repeat Item')
    date = get_key(repeat_item, 'date', 'OpenGym 训练日期')
    target = get_key(repeat_item, 'workout_id', 'OpenGym 训练 ID')
    start_text = native('gettext', '训练日期文本', WFTextActionText=text(date, ' 00:00:00'))
    day_start = native('detect.date', '当日开始', WFInput=attachment(start_text))
    next_midnight = add_day(day_start, '次日开始')
    # Query through the second midnight so late-starting sessions can cross midnight;
    # the import API clips samples to the selected Apple workout window (max 24h).
    day_end = add_day(next_midnight, '后日开始（覆盖跨午夜训练）')

    # Preserve the existing Actions entity query and iPhone-verified date interval pattern.
    apple_workouts = action('com.sindresorhus.Actions.WorkoutAppEntity', '当天完整 Apple 训练列表',
        WFContentItemSortProperty='startDate', WFContentItemSortOrder='Oldest First',
        WFContentItemLimitEnabled=False,
        AppIntentDescriptor={'TeamIdentifier': 'YG56YK5RN5', 'BundleIdentifier': 'com.sindresorhus.Actions',
                             'Name': 'Actions', 'AppIntentIdentifier': 'WorkoutAppEntity',
                             'ActionRequiresAppInstallation': True},
        WFContentItemFilter={'Value': {'WFActionParameterFilterTemplates': [],
                                      'WFActionParameterFilterPrefix': 1,
                                      'WFContentPredicateBoundedDate': False},
                             'WFSerializationType': 'WFContentPredicateTableTemplate'})
    apple_count = native('count', 'Apple 训练数量', Input=attachment(apple_workouts), WFCountType='Items')
    apple_count_number = number(apple_count, 'Apple 训练数量（数字）')
    has_apple_group = uid()
    begin_if(apple_count_number, has_apple_group, 2, WFNumberValue='0')

    id_text = native('gettext', '全部 Apple 训练标识', WFTextActionText=text(prop(apple_workouts, 'Identifier')))
    apple_ids = combine('Apple 训练标识列表', id_text)
    start_dates = iso(prop(apple_workouts, 'startDate', True), '全部训练开始日期')
    starts = combine('Apple 开始时间列表', start_dates)
    end_dates = iso(prop(apple_workouts, 'endDate', True), '全部训练结束日期')
    ends = combine('Apple 结束时间列表', end_dates)

    samples = native('filter.health.quantity', '当天心率样本',
        WFContentItemSortProperty='Start Date', WFContentItemSortOrder='Oldest First',
        WFHKSampleFilteringUnit='count', WFHKSampleFilteringFillMissing=False,
        WFContentItemLimitEnabled=False,
        WFContentItemFilter={'Value': {'WFActionParameterFilterPrefix': 1,
            'WFContentPredicateBoundedDate': False,
            'WFActionParameterFilterTemplates': [
                {'Bounded': True, 'Operator': 4, 'Removable': False, 'Property': 'Type',
                 'Values': {'Enumeration': {'Value': 'Heart Rate', 'WFSerializationType': 'WFStringSubstitutableState'}}},
                {'Bounded': True, 'Operator': 1003, 'Removable': False, 'Property': 'Start Date',
                 'Values': {'Date': attachment(day_start), 'AnotherDate': attachment(day_end), 'Unit': 16, 'Number': '1'}}]},
            'WFSerializationType': 'WFContentPredicateTableTemplate'})
    sample_count = native('count', '心率样本数量', Input=attachment(samples), WFCountType='Items')
    sample_count_number = number(sample_count, '心率样本数量（数字）')
    has_samples_group = uid()
    begin_if(sample_count_number, has_samples_group, 2, WFNumberValue='0')
    sample_dates = native('properties.health.quantity', '全部心率开始日期',
                          WFInput=attachment(samples), WFContentItemPropertyName='Start Date')
    formatted_dates = iso(sample_dates, '全部 ISO 心率时间')
    dates = combine('心率日期列表', formatted_dates)
    sample_values = native('properties.health.quantity', '全部心率值', WFInput=attachment(samples),
                           WFContentItemPropertyName='Value')
    values = combine('心率数值列表', sample_values)
    import_workout(date, target, dates, values, apple_ids, starts, ends)
    otherwise(has_samples_group)
    # Empty samples are normal; avoid property extraction and let the backend count a skip.
    import_workout(date, target, '', '', apple_ids, starts, ends)
    end_if(has_samples_group)
    otherwise(has_apple_group)
    # Empty Apple list is normal; avoid property extraction and let the backend count a skip.
    import_workout(date, target, '', '', '', '', '')
    end_if(has_apple_group)
    native('repeat.each', WFControlFlowMode=2, GroupingIdentifier=loop_id)
    end_if(missing_workouts)
    otherwise(has_pending)
    # A zero pending count is valid; in that case an empty workouts array has no value token.
    end_if(has_pending)

    saved_count = native('count', '已保存训练数', Input=attachment(named('已保存训练')), WFCountType='Items')
    item_skips = native('count', '单条跳过数', Input=attachment(named('已跳过训练')), WFCountType='Items')
    failed_count = native('count', '失败训练数', Input=attachment(named('批量失败响应')), WFCountType='Items')
    native('showresult', Text=text('批量心率同步完成。\n已保存：', saved_count,
        '\n已跳过（逐条结果）：', item_skips, '\n日期歧义跳过：', ambiguous_count,
        '\n失败：', failed_count, '\n',
        '失败响应：', named('批量失败响应')))
    end_if(missing_ambiguous)
    end_if(missing_pending)
    workflow_name = 'OpenGym 一键同步心率'

workflow = {
    'WFWorkflowName': workflow_name,
    'WFWorkflowClientVersion': '4528.0.4.3',
    'WFWorkflowMinimumClientVersion': 3010,
    'WFWorkflowMinimumClientVersionString': '3010',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59764},
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowTypes': [],
    'WFWorkflowActions': actions,
    'WFWorkflowImportQuestions': [],
}

# Catch broken action references and malformed flow-group encodings before writing/signing.
seen = set()
action_types = {}
flow_stack = []
in_repeat = 0


def validate_refs(node):
    if isinstance(node, dict):
        if node.get('Type') == 'ActionOutput':
            assert node['OutputUUID'] in seen, node
        for value in node.values():
            validate_refs(value)
    elif isinstance(node, list):
        for value in node:
            validate_refs(value)


for entry in actions:
    ident = entry['WFWorkflowActionIdentifier']
    params = entry['WFWorkflowActionParameters']
    mode = params.get('WFControlFlowMode')
    if ident == 'is.workflow.actions.repeat.each':
        if mode == 0:
            assert params['WFInput']['WFSerializationType'] == 'WFTextTokenAttachment'
            flow_stack.append(('repeat', params['GroupingIdentifier']))
            in_repeat += 1
        elif mode == 2:
            assert flow_stack and flow_stack[-1] == ('repeat', params['GroupingIdentifier'])
            flow_stack.pop()
            in_repeat -= 1
        else:
            raise AssertionError(('unexpected repeat mode', params))
    if ident == 'is.workflow.actions.conditional':
        if mode == 0:
            assert params['WFInput']['Type'] == 'Variable'
            assert params['WFInput']['Variable']['WFSerializationType'] == 'WFTextTokenAttachment'
            if params.get('WFCondition') == 2:
                assert params['WFNumberValue'] == '0', 'Condition 2 is greater than; zero cases belong in Otherwise.'
            flow_stack.append(('if', params['GroupingIdentifier']))
        elif mode == 1:
            assert flow_stack and flow_stack[-1] == ('if', params['GroupingIdentifier'])
        elif mode == 2:
            assert flow_stack and flow_stack[-1] == ('if', params['GroupingIdentifier'])
            flow_stack.pop()
    if ident == 'is.workflow.actions.getvalueforkey':
        assert 'WFDictionary' not in params
        assert params['WFInput']['WFSerializationType'] == 'WFTextTokenAttachment'
    if ident == 'is.workflow.actions.count':
        assert 'WFInput' not in params and 'Input' in params
    if ident == 'is.workflow.actions.format.date':
        assert params['WFDate']['WFSerializationType'] == 'WFTextTokenString'
    if ident == 'is.workflow.actions.adjustdate':
        assert params['WFDate']['WFSerializationType'] == 'WFTextTokenString'
        assert params['WFDuration']['Value'] == {'Magnitude': '1', 'Unit': 'days'}
    if ident == 'is.workflow.actions.text.combine':
        assert params['text']['WFSerializationType'] == 'WFTextTokenAttachment'
    if ident == 'is.workflow.actions.showresult' and not args.smoke:
        assert in_repeat == 0, 'No per-item dialogs are allowed inside the repeat.'
    validate_refs(entry)
    seen.add(params['UUID'])
    action_types[params['UUID']] = ident

assert not flow_stack, flow_stack
assert in_repeat == 0
assert len(seen) == len(actions)
if args.smoke:
    assert not any('downloadurl' in entry['WFWorkflowActionIdentifier'] or
                   'health' in entry['WFWorkflowActionIdentifier'] or
                   'WorkoutAppEntity' in entry['WFWorkflowActionIdentifier'] for entry in actions)
else:
    requests = [entry for entry in actions if entry['WFWorkflowActionIdentifier'] == 'is.workflow.actions.downloadurl']
    pending_requests = [entry for entry in requests if entry['WFWorkflowActionParameters']['WFURL']['Value']['string'].endswith('/pending')]
    import_requests = [entry for entry in requests if entry['WFWorkflowActionParameters']['WFURL']['Value']['string'].endswith('/import')]
    assert len(pending_requests) == 1 and len(import_requests) == 3
    pending_params = pending_requests[0]['WFWorkflowActionParameters']
    assert pending_params['WFHTTPMethod'] == 'POST' and pending_params['WFHTTPBodyType'] == 'JSON'
    assert pending_params['WFJSONValues']['Value']['WFDictionaryFieldValueItems'] == []
    for request in import_requests:
        params = request['WFWorkflowActionParameters']
        assert params['WFHTTPMethod'] == 'POST' and params['WFHTTPBodyType'] == 'JSON'
        keys = {field['WFKey']['Value']['string'] for field in params['WFJSONValues']['Value']['WFDictionaryFieldValueItems']}
        assert keys == {'batch', 'date', 'workout_id', 'dates', 'values', 'apple_workout_id',
                        'started_at', 'ended_at', 'sync_workout_time'}
    workout_query = next(entry for entry in actions if entry['WFWorkflowActionIdentifier'] ==
                         'com.sindresorhus.Actions.WorkoutAppEntity')
    assert workout_query['WFWorkflowActionParameters']['WFContentItemLimitEnabled'] is False

OUT.mkdir(parents=True, exist_ok=True)
out = pathlib.Path('/tmp/OpenGym-batch-smoke.unsigned.shortcut') if args.smoke else OUT / 'OpenGym-batch.unsigned.shortcut'
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f'{out}: {len(actions)} actions; action references and flow groups validated; no credential embedded')
