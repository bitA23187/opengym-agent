#!/usr/bin/env python3
"""Build a credential-free iPhone test shortcut; sign separately with Apple's CLI.

Native Health actions follow mm/heartbridge's published shortcut. Actions' entity
query/startDate/endDate encoding follows the public WorkoutAppEntity example
46f1bdaacd2a40e3a2e49d077ae34ce2. Identifier is a built-in entity property;
its resolution and Health access still require testing on the target iPhone.
"""
import argparse
import pathlib
import plistlib
import uuid

OUT = pathlib.Path(__file__).resolve().parents[1] / 'artifacts' / 'shortcuts'
options = argparse.ArgumentParser(description=__doc__)
options.add_argument('--smoke', action='store_true', help='Generate a native-only parameter parsing check, without Health/network/credentials')
options.add_argument('--response-smoke', action='store_true', help='Test response handling only, without Health/network/credentials')
options.add_argument('--debug', action='store_true', help='Include the four diagnostic progress dialogs')
args = options.parse_args()
actions = []


def uid():
    return str(uuid.uuid4()).upper()


def attachment(value):
    return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}


def text(*parts):
    value, refs = '', {}
    for p in parts:
        if isinstance(p, dict):
            offset = len(value.encode('utf-16-le')) // 2
            refs[f'{{{offset}, 1}}'] = p
            value += '\ufffc'
        else:
            value += p
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
    # All built-in action names include dots too (e.g. format.date).
    return action('is.workflow.actions.' + identifier, name, **params)


def prop(ref, key, entity=False):
    ag = {'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': key}
    if entity:
        ag['PropertyUserInfo'] = {'WFLinkEntityContentPropertyUserInfoPropertyIdentifier': key}
    return {**ref, 'Aggrandizements': [ag]}


def fields(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFKey': text(k), 'WFItemType': 0,
         'WFValue': text(v) if isinstance(v, dict) else text(v)}
        for k, v in items.items()]}, 'WFSerializationType': 'WFDictionaryFieldValue'}


def show(*parts):
    if parts and isinstance(parts[0], str) and parts[0].startswith(('1/4', '2/4', '3/4', '4/4')) and not args.debug:
        return
    native('showresult', Text=text(*parts))


def combine(name, ref):
    return native('text.combine', name, text=attachment(ref), WFTextSeparator='New Lines')


def iso(ref, name):
    return native('format.date', name, WFDate=text(ref),
                  WFDateFormatStyle='Custom', WFDateFormat="yyyy-MM-dd'T'HH:mm:ssXXX",
                  WFISO8601IncludeTime=True)


native('comment', WFCommentActionText='OpenGym 心率同步 · 日常版 4.1\n从 OpenGym 训练详情启动，自动同步心率和训练起止时间。需要 Actions App。仅向网页参数指定的自建 OpenGym 服务器上传。从已登录网页启动，无需填写凭证。')
incoming = native('detect.dictionary', '网页同步参数', WFInput=attachment({'Type': 'ExtensionInput'}))
server = native('getvalueforkey', '服务器地址', WFInput=attachment(incoming), WFDictionaryKey='server', WFGetDictionaryValueType='Value')
credential = native('getvalueforkey', '本次同步授权', WFInput=attachment(incoming), WFDictionaryKey='authorization', WFGetDictionaryValueType='Value')
missing = uid()
native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(credential)}, WFCondition=101, WFControlFlowMode=0, GroupingIdentifier=missing)
native('showresult', Text='请从已登录的 OpenGym 网页点击同步，无需填写凭证。')
native('exit')
native('conditional', WFControlFlowMode=2, GroupingIdentifier=missing)
input_ref = {'Type': 'ExtensionInput'}
# Do not display the invocation input: it contains a short-lived grant.
group = uid()
# Conditional inputs use a variable-parameter state, not a bare attachment.
# A bare attachment imports but leaves the condition's input unconfigured.
native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(input_ref)}, WFCondition=101,
       WFControlFlowMode=0, GroupingIdentifier=group)
show('没有收到网页参数。请返回 OpenGym，打开训练详情，点击「在 iPhone 同步心率」。')
native('exit')
native('conditional', WFControlFlowMode=2, GroupingIdentifier=group)
incoming = native('detect.dictionary', '网页参数', WFInput=attachment(input_ref))
date = native('getvalueforkey', '训练日期', WFInput=attachment(incoming),
              WFDictionaryKey='date', WFGetDictionaryValueType='Value')
target = native('getvalueforkey', 'OpenGym 训练 ID', WFInput=attachment(incoming),
                WFDictionaryKey='workout_id', WFGetDictionaryValueType='Value')
start_text = native('gettext', '训练日期文本', WFTextActionText=text(date, ' 00:00:00'))
day_start = native('detect.date', '当日开始', WFInput=attachment(start_text))
# Same-date 00:00–23:59:59 produced zero Health samples on the target iPhone.
# The user verified a date-to-next-date range returns ~1900 samples. Use a
# calendar-day adjustment so month/year transitions work without hand entry.
day_end = native('adjustdate', '次日开始', WFDate=text(day_start), WFAdjustOperation='Add',
    WFDuration={'Value': {'Magnitude': '1', 'Unit': 'days'}, 'WFSerializationType': 'WFQuantityFieldValue'},
    WFAdjustOffsetPicker={'Value': {'Operation': 'Add', 'Unit': 'Day', 'Value': 1}, 'WFSerializationType': 'WFTimeOffsetValue'})
show('2/4 网页参数读取成功。\n训练日期：', date, '\n健康查询起点：', day_start,
     '\n健康查询终点：', day_end, '\n接下来由 Actions 读取完整 Workouts 列表，无需选择单条。')
workouts = action('com.sindresorhus.Actions.WorkoutAppEntity', 'Workouts',
    WFContentItemSortProperty='startDate', WFContentItemSortOrder='Oldest First',
    WFContentItemLimitEnabled=False,
    AppIntentDescriptor={'TeamIdentifier': 'YG56YK5RN5', 'BundleIdentifier': 'com.sindresorhus.Actions',
                         'Name': 'Actions', 'AppIntentIdentifier': 'WorkoutAppEntity',
                         'ActionRequiresAppInstallation': True},
    WFContentItemFilter={'Value': {'WFActionParameterFilterTemplates': [],
                                  'WFActionParameterFilterPrefix': 1,
                                  'WFContentPredicateBoundedDate': False},
                         'WFSerializationType': 'WFContentPredicateTableTemplate'})
workout_count = native('count', 'Apple 训练数量', Input=attachment(workouts), WFCountType='Items')
id_text = native('gettext', '全部 Apple 训练标识', WFTextActionText=text(prop(workouts, 'Identifier')))
apple_ids = combine('Apple 训练标识列表', id_text)
start_dates = iso(prop(workouts, 'startDate', True), '全部训练开始日期')
starts = combine('Apple 开始时间列表', start_dates)
end_dates = iso(prop(workouts, 'endDate', True), '全部训练结束日期')
ends = combine('Apple 结束时间列表', end_dates)
show('3/4 已读取 Apple 训练：', workout_count, ' 条。\n接下来读取所选日期的心率。首次使用请允许读取健康数据。')
samples = native('filter.health.quantity', '同一份心率样本',
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
sample_dates = native('properties.health.quantity', '全部心率开始日期',
                      WFInput=attachment(samples), WFContentItemPropertyName='Start Date')
formatted_dates = iso(sample_dates, '全部 ISO 心率时间')
dates = combine('dates', formatted_dates)
sample_values = native('properties.health.quantity', '全部心率值', WFInput=attachment(samples), WFContentItemPropertyName='Value')
values = combine('values', sample_values)
show('4/4 已准备上传。\n日期：', date, '\n心率样本：', sample_count,
     '\nApple 训练：', workout_count, '\n\n点完成上传到你的 OpenGym 账户；服务器仅保存目标训练时段内的心率。')
response = native('downloadurl', '服务器返回结果', WFURL=text(server, '/api/heart-rate/import'),
    WFHTTPMethod='POST', WFHTTPBodyType='JSON', ShowHeaders=True,
    WFHTTPHeaders=fields({'Authorization': credential}),
    WFJSONValues=fields({'workout_id': target, 'dates': dates, 'values': values,
                         'apple_workout_id': apple_ids, 'started_at': starts, 'ended_at': ends,
                         'sync_workout_time': 'true'}))
def finish_response(response):
    # Dictionary values have an unknown content type. A numeric comparison on
    # that output imports but leaves its RHS unbound. Convert explicitly first.
    stored = native('getvalueforkey', '已保存的训练数量', WFInput=attachment(response),
                    WFDictionaryKey='storedWorkouts', WFGetDictionaryValueType='Value')
    missing = uid()
    native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(stored)}, WFCondition=101,
           WFControlFlowMode=0, GroupingIdentifier=missing)
    show('同步失败：\n', response)
    native('exit')
    native('conditional', WFControlFlowMode=2, GroupingIdentifier=missing)
    count = native('number', '已保存训练数量（数字）', WFNumberActionNumber=attachment(stored))
    group = uid()
    native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(count)}, WFCondition=2, WFNumberValue='0',
           WFControlFlowMode=0, GroupingIdentifier=group)
    native('nothing')
    native('conditional', WFControlFlowMode=1, GroupingIdentifier=group)
    show('同步失败：\n', response)
    native('conditional', WFControlFlowMode=2, GroupingIdentifier=group)


finish_response(response)

workflow = {
    'WFWorkflowName': 'OpenGym 心率同步',
    'WFWorkflowClientVersion': '4528.0.4.3',
    'WFWorkflowMinimumClientVersion': 3010,
    'WFWorkflowMinimumClientVersionString': '3010',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59764},
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowTypes': [],
    'WFWorkflowActions': actions,
    # iOS reported a stalled Add flow after filling an import question. Keep
    # configuration in the webpage invocation; no import questions are needed.
    'WFWorkflowImportQuestions': [],
}

if args.smoke:
    # Execute the exact generated native input/parsing actions on macOS before
    # asking the user to test iPhone-only Health/AppEntity actions.
    stop = next(i for i, a in enumerate(actions) if a['WFWorkflowActionIdentifier'] == 'com.sindresorhus.Actions.WorkoutAppEntity')
    actions = [a for a in actions[1:stop] if a['WFWorkflowActionIdentifier'] != 'is.workflow.actions.showresult']
    fake_dates = native('gettext', '模拟样本时间', WFTextActionText='2026-10-22T19:27:48+08:00\n2026-10-22T21:55:48+08:00')
    parsed_dates = native('detect.date', '两条模拟日期', WFInput=attachment(fake_dates))
    n = native('count', '模拟样本数量', Input=attachment(parsed_dates), WFCountType='Items')
    formatted = iso(parsed_dates, '模拟 ISO 时间列表')
    combined = combine('模拟合并列表', formatted)
    native('gettext', '参数检查结果', WFTextActionText=text(
        'date=', date, '; workout_id=', target, '; start=', day_start, '; end=', day_end,
        '; count=', n, '\niso_dates=\n', combined))
    workflow['WFWorkflowName'] = 'OpenGym 参数验证 v2c'
    workflow['WFWorkflowActions'] = actions

if args.response_smoke:
    actions = []
    response = native('detect.dictionary', '服务器返回结果', WFInput=attachment(input_ref))
    finish_response(response)
    workflow['WFWorkflowName'] = 'OpenGym 同步结果验证'
    workflow['WFWorkflowActions'] = actions

# Catch broken wires before signing. This validates the artifact, not iOS runtime behavior.
seen = set()
action_types = {}
def validate_refs(node):
    if isinstance(node, dict):
        if node.get('Type') == 'ActionOutput':
            assert node['OutputUUID'] in seen, node
        for val in node.values():
            validate_refs(val)
    elif isinstance(node, list):
        for val in node:
            validate_refs(val)

for item in actions:
    identifier = item['WFWorkflowActionIdentifier']
    params = item['WFWorkflowActionParameters']
    if identifier == 'is.workflow.actions.conditional' and params['WFControlFlowMode'] == 0:
        assert params['WFInput']['Type'] == 'Variable'
        assert params['WFInput']['Variable']['WFSerializationType'] == 'WFTextTokenAttachment'
        if params['WFCondition'] == 2:
            source = params['WFInput']['Variable']['Value']['OutputUUID']
            assert action_types[source] == 'is.workflow.actions.number'
            assert params['WFNumberValue'] == '0'
    if identifier == 'is.workflow.actions.getvalueforkey':
        assert 'WFDictionary' not in params
        assert params['WFInput']['WFSerializationType'] == 'WFTextTokenAttachment'
    if identifier == 'is.workflow.actions.count':
        assert 'WFInput' not in params and 'Input' in params
    if identifier == 'is.workflow.actions.format.date':
        assert params['WFDate']['WFSerializationType'] == 'WFTextTokenString'
    if identifier == 'is.workflow.actions.adjustdate':
        assert params['WFDate']['WFSerializationType'] == 'WFTextTokenString'
        assert params['WFDuration']['Value'] == {'Magnitude': '1', 'Unit': 'days'}
    if identifier == 'is.workflow.actions.text.combine':
        assert params['text']['WFSerializationType'] == 'WFTextTokenAttachment'
    validate_refs(item)
    seen.add(item['WFWorkflowActionParameters']['UUID'])
    action_types[params['UUID']] = identifier
assert len(seen) == len(actions)
OUT.mkdir(parents=True, exist_ok=True)
out = OUT / ('OpenGym-response.unsigned.shortcut' if args.response_smoke else 'OpenGym-parameters.unsigned.shortcut' if args.smoke else 'OpenGym-heart-rate.unsigned.shortcut')
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f'{out}: {len(actions)} actions; references validated; no credential embedded')
