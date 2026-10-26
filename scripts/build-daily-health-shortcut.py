#!/usr/bin/env python3
"""Build daily Health sync (RHR, SDNN HRV, sleep); iPhone validation required."""
import argparse
import json
from datetime import datetime, timedelta, timezone
import pathlib
import plistlib
import uuid

OUT = pathlib.Path(__file__).resolve().parents[1] / 'artifacts' / 'shortcuts'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--smoke', action='store_true', help='Generate a fixture-only dictionary/Repeat with Each check')
parser.add_argument('--serialization-smoke', action='store_true', help='Exercise production row serialization without Health or network')
parser.add_argument('--sleep-probe', action='store_true', help='Local-only bounded Sleep property probe, without loops or credentials')
parser.add_argument('--sample-count', type=int, default=1000)
args = parser.parse_args()
assert sum([args.smoke, args.serialization_smoke, args.sleep_probe]) <= 1
assert 1 <= args.sample_count <= 2000
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
                  WFDateFormatStyle='Custom', WFDateFormat="yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
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


def append_summary(*parts):
    item = native('gettext', '本项同步结果', WFTextActionText=text(*parts))
    native('appendvariable', WFInput=attachment(item), WFVariableName='同步结果')


def classify_response(response, label):
    error = get_key(response, 'error', label + ' 错误')
    error_group = uid()
    missing_guard(error, error_group)
    received = get_key(response, 'received', label + ' 本次样本数量')
    count_group = uid()
    missing_guard(received, count_group)
    append_summary(label, '：失败，服务器响应缺少样本数量。')
    otherwise(count_group)
    count = number(received, label + ' 接收数（数字）')
    append_summary(label, '：已接收 ', count, ' 条。')
    skipped = get_key(response, 'skippedOutsideWindow', label + ' 窗口外数量')
    skipped_group = uid()
    missing_guard(skipped, skipped_group)
    native('nothing')
    otherwise(skipped_group)
    skipped_count = number(skipped, label + ' 跳过数（数字）')
    nonzero = uid()
    begin_if(skipped_count, nonzero, 2, WFNumberValue='0')
    append_summary('  窗口外跳过 ', skipped_count, ' 条。')
    end_if(nonzero)
    end_if(skipped_group)
    end_if(count_group)
    otherwise(error_group)
    append_summary(label, '：失败，', error)
    end_if(error_group)


def serialize_rows(samples, label, fixture=False):
    # Preserve each sample as one dictionary: bulk property extraction can omit
    # empty Source values and silently shift parallel columns, especially Sleep.
    loop = uid()
    native('repeat.each', WFInput=attachment(samples), WFControlFlowMode=0, GroupingIdentifier=loop)
    item = named('Repeat Item')
    def detail(key, field):
        return get_key(item, field, label + ' 本条' + key) if fixture else native('properties.health.quantity', label + ' 本条' + key, WFInput=attachment(item), WFContentItemPropertyName=key)
    dates = iso(detail('Start Date', 'start'), label + ' 本条开始 ISO')
    ends = iso(detail('End Date', 'end'), label + ' 本条结束 ISO')
    value = detail('Value', 'value')
    source = detail('Source', 'source')
    row = native('dictionary', label + ' 完整记录', WFItems=fields({'start': dates, 'end': ends, 'value': value, 'source': source}))
    row_json = native('gettext', label + ' 记录 JSON', WFTextActionText=text(row))
    # Repeat collects its last action once per item. Returning Append Variable
    # here made it collect every growing prefix (N*(N+1)/2 records).
    # Return only this row's JSON, then consume Repeat Results directly.
    rows = native('repeat.each', label + ' 完整记录列表', WFControlFlowMode=2, GroupingIdentifier=loop)
    joined = native('text.combine', label + ' 记录合并', text=attachment(rows), WFTextSeparator='Custom', WFTextCustomSeparator=',')
    rows_json = native('gettext', label + ' 记录数组 JSON', WFTextActionText=text('[', joined, ']'))
    return rows_json


workflow_name = 'OpenGym 睡眠读取检查' if args.sleep_probe else 'OpenGym 序列化规模验证' if args.serialization_smoke else 'OpenGym 日常健康汇总验证' if args.smoke else 'OpenGym 日常健康同步'
if not args.sleep_probe:
    native('comment', WFCommentActionText='OpenGym 日常健康同步 v5\n读取最近 8 天的静息心率、HRV 和睡眠。从已登录的 OpenGym 网页启动，无需填写服务器或凭证。同步完成后显示汇总。')
    empty = native('list', '初始同步结果', WFItems=[])
    native('setvariable', WFInput=attachment(empty), WFVariableName='同步结果')
if args.sleep_probe:
    native('comment', WFCommentActionText='仅本机检查最近 2 天最多 20 条睡眠样本。不需要服务器或凭证，不上传数据，不写入健康，没有重复循环。会显示两次结果；第一次点完成后继续检查来源。若卡住，请停止并记下高亮动作。')
    now = native('date', '检查时间', WFDateActionMode='Current Date')
    start = native('adjustdate', '两天前', WFDate=text(now), WFAdjustOperation='Subtract',
        WFDuration={'Value': {'Magnitude': '2', 'Unit': 'days'}, 'WFSerializationType': 'WFQuantityFieldValue'},
        WFAdjustOffsetPicker={'Value': {'Operation': 'Subtract', 'Unit': 'Day', 'Value': 2}, 'WFSerializationType': 'WFTimeOffsetValue'})
    samples = native('filter.health.quantity', '最近睡眠（最多20条）',
        WFContentItemSortProperty='Start Date', WFContentItemSortOrder='Latest First',
        WFHKSampleFilteringUnit='hr', WFHKSampleFilteringFillMissing=False,
        WFContentItemLimitEnabled=True, WFContentItemLimitNumber=20,
        WFContentItemFilter={'Value': {'WFContentPredicateBoundedDate': False, 'WFActionParameterFilterPrefix': 1,
            'WFActionParameterFilterTemplates': [
                {'Bounded': True, 'Operator': 4, 'Removable': False, 'Property': 'Type',
                 'Values': {'Enumeration': {'Value': 'Sleep', 'WFSerializationType': 'WFStringSubstitutableState'}}},
                {'Bounded': True, 'Operator': 1003, 'Removable': False, 'Property': 'Start Date',
                 'Values': {'Date': attachment(start), 'AnotherDate': attachment(now), 'Unit': 16, 'Number': '1'}}]},
            'WFSerializationType': 'WFContentPredicateTableTemplate'})
    counts = [native('count', '睡眠样本数量', Input=attachment(samples), WFCountType='Items')]
    group = uid()
    begin_if(number(counts[0], '睡眠样本数量数字'), group, 2, WFNumberValue='0')
    for key, label in [('Start Date', '开始时间'), ('End Date', '结束时间'), ('Value', '睡眠类别')]:
        result = native('properties.health.quantity', '检查：读取' + label, WFInput=attachment(samples), WFContentItemPropertyName=key)
        counts.append(native('count', label + '数量', Input=attachment(result), WFCountType='Items'))
    native('showresult', Text=text('前三项读取完成。\n', *['样本=', counts[0], '；开始=', counts[1], '；结束=', counts[2], '；类别=', counts[3]], '\n点“完成”继续单独读取来源。'))
    sources = native('properties.health.quantity', '检查：单独读取来源', WFInput=attachment(samples), WFContentItemPropertyName='Source')
    count = native('count', '来源数量', Input=attachment(sources), WFCountType='Items')
    native('showresult', Text=text('检查完成。\n', *['样本=', counts[0], '；开始=', counts[1], '；结束=', counts[2], '；类别=', counts[3]], '；来源=', count, '\n请反馈这些数量。此检查没有上传或写入数据。'))
    otherwise(group)
    native('showresult', Text=text('没有读到最近两天的睡眠样本。请检查健康中的睡眠记录和快捷指令读取权限。此检查没有上传或写入数据。'))
    end_if(group)
elif args.serialization_smoke:
    base = datetime(2026, 10, 22, tzinfo=timezone(timedelta(hours=8)))
    fixture = {'samples': [{'start': (base+timedelta(minutes=i)).isoformat(), 'end': (base+timedelta(minutes=i+1)).isoformat(), 'value': 'Core', 'source': 'Watch "fixture"\nsecond line' if i%2==0 else ''} for i in range(args.sample_count)]}
    raw = native('gettext', '虚构记录', WFTextActionText=json.dumps(fixture, ensure_ascii=False))
    parsed = native('detect.dictionary', '解析虚构记录', WFInput=attachment(raw))
    rows = serialize_rows(get_key(parsed, 'samples', '虚构记录列表'), '规模验证', fixture=True)
    wrapped = native('gettext', '数组包装', WFTextActionText=text('{"samples":', rows, '}'))
    parsed_rows = native('detect.dictionary', '重新解析完整数组', WFInput=attachment(wrapped))
    count = native('count', '最终记录数量', Input=attachment(get_key(parsed_rows, 'samples', '最终记录列表')), WFCountType='Items')
    first_source = get_key(parsed_rows, 'samples.1.source', '首条来源')
    second_source = get_key(parsed_rows, 'samples.2.source', '空来源')
    native('gettext', '规模验证报告', WFTextActionText=text('records=', count, '; firstSource=', first_source, '; secondSource=', second_source))
elif args.smoke:
    for label, values in [('静息心率', {'error': '模拟区间校验错误'}), ('HRV', {'ok': 'true', 'received': '2', 'skippedOutsideWindow': '1'}), ('睡眠', {'ok': 'true', 'received': '0', 'skippedOutsideWindow': '0'}), ('格式异常', {'ok': 'true'})]:
        response = native('dictionary', label + ' 模拟返回', WFItems=fields(values))
        classify_response(response, label)
else:
    incoming = native('detect.dictionary', '网页同步参数', WFInput=attachment({'Type': 'ExtensionInput'}))
    server = native('getvalueforkey', '服务器地址', WFInput=attachment(incoming), WFDictionaryKey='server', WFGetDictionaryValueType='Value')
    credential = native('getvalueforkey', '本次同步授权', WFInput=attachment(incoming), WFDictionaryKey='authorization', WFGetDictionaryValueType='Value')
    missing = uid()
    native('conditional', WFInput={'Type': 'Variable', 'Variable': attachment(credential)}, WFCondition=101, WFControlFlowMode=0, GroupingIdentifier=missing)
    native('showresult', Text='请从已登录的 OpenGym 网页点击同步，无需填写凭证。')
    native('exit')
    native('conditional', WFControlFlowMode=2, GroupingIdentifier=missing)
    now = native('date', '现在', WFDateActionMode='Current Date')
    timezone = native('format.date', '本地 IANA 时区', WFDate=text(now), WFDateFormatStyle='Custom', WFDateFormat='VV')
    today = native('format.date', '今天日期', WFDate=text(now), WFDateFormatStyle='Custom', WFDateFormat='yyyy-MM-dd')
    midnight_text = native('gettext', '今天零点文本', WFTextActionText=text(today, ' 00:00:00'))
    midnight = native('detect.date', '今天零点', WFInput=attachment(midnight_text))
    start = native('adjustdate', '八天前零点', WFDate=text(midnight), WFAdjustOperation='Subtract',
        WFDuration={'Value': {'Magnitude': '8', 'Unit': 'days'}, 'WFSerializationType': 'WFQuantityFieldValue'},
        WFAdjustOffsetPicker={'Value': {'Operation': 'Subtract', 'Unit': 'Day', 'Value': 8}, 'WFSerializationType': 'WFTimeOffsetValue'})
    start_iso, end_iso = iso(start, '查询开始 ISO'), iso(now, '查询结束 ISO')
    for metric, health_type, unit, label in [('restingHeartRate', 'Resting Heart Rate', 'bpm', '静息心率'), ('hrv', 'Heart Rate Variability', 'ms', 'HRV'), ('sleep', 'Sleep', '', '睡眠')]:
        samples = native('filter.health.quantity', label + ' 样本',
            WFContentItemSortProperty='Start Date', WFContentItemSortOrder='Oldest First',
            WFHKSampleFilteringUnit='ms' if metric == 'hrv' else 'count/min' if metric == 'restingHeartRate' else 'hr',
            WFHKSampleFilteringFillMissing=False, WFContentItemLimitEnabled=False,
            WFContentItemFilter={'Value': {'WFContentPredicateBoundedDate': False, 'WFActionParameterFilterPrefix': 1,
                'WFActionParameterFilterTemplates': [
                    {'Bounded': True, 'Operator': 4, 'Removable': False, 'Property': 'Type',
                     'Values': {'Enumeration': {'Value': health_type, 'WFSerializationType': 'WFStringSubstitutableState'}}},
                    {'Bounded': True, 'Operator': 1003, 'Removable': False, 'Property': 'Start Date',
                     'Values': {'Date': attachment(start), 'AnotherDate': attachment(now), 'Unit': 16, 'Number': '1'}}]},
                'WFSerializationType': 'WFContentPredicateTableTemplate'})
        count = number(native('count', label + ' 样本数', Input=attachment(samples), WFCountType='Items'), label + ' 数量数字')
        group = uid()
        begin_if(count, group, 2, WFNumberValue='0')
        rows_json = serialize_rows(samples, label)
        url = native('gettext', label + ' 上传地址', WFTextActionText=text(server, '/api/daily-health/import'))
        response = native('downloadurl', label + ' 服务器返回', WFURL=text(url), WFHTTPMethod='POST', WFHTTPBodyType='JSON', ShowHeaders=True,
            WFHTTPHeaders=fields({'Authorization': credential}),
            WFJSONValues=fields({'metric': metric, 'unit': unit, 'timezone': timezone, 'start': start_iso, 'end': end_iso, 'samplesJson': rows_json}))
        classify_response(response, label)
        otherwise(group)
        append_summary(label, '：没有读到样本，请检查健康权限与历史数据。')
        end_if(group)
summary = None if args.serialization_smoke or args.sleep_probe else combine('全部同步结果', named('同步结果'))
if not args.smoke and not args.serialization_smoke and not args.sleep_probe:
    native('showresult', Text=text(summary))
elif args.smoke:
    native('gettext', '验证结果文本', WFTextActionText=text(summary))
workflow = {'WFWorkflowName': workflow_name, 'WFWorkflowClientVersion': '4528.0.4.3',
    'WFWorkflowMinimumClientVersion': 3010, 'WFWorkflowMinimumClientVersionString': '3010',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59764},
    'WFWorkflowHasShortcutInputVariables': True, 'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowTypes': [], 'WFWorkflowActions': actions, 'WFWorkflowImportQuestions': []}
assert sum(a['WFWorkflowActionIdentifier'] == 'is.workflow.actions.showresult' for a in actions) == (3 if args.sleep_probe else 0 if args.smoke or args.serialization_smoke else 2)
flow=[]
for entry in actions:
    if entry['WFWorkflowActionIdentifier'] != 'is.workflow.actions.conditional': continue
    params=entry['WFWorkflowActionParameters'];mode=params['WFControlFlowMode'];group=params['GroupingIdentifier']
    if mode==0: flow.append(group)
    else:
        assert flow and flow[-1]==group
        if mode==2: flow.pop()
assert not flow
seen=set()
def check(value):
    if isinstance(value,dict):
        if value.get('Type')=='ActionOutput': assert value['OutputUUID'] in seen, value
        for v in value.values(): check(v)
    elif isinstance(value,list):
        for v in value: check(v)
for a in actions:
    check(a); ident=a['WFWorkflowActionParameters']['UUID']; assert ident not in seen; seen.add(ident)
if args.smoke or args.serialization_smoke: assert not any('health' in a['WFWorkflowActionIdentifier'] or 'downloadurl' in a['WFWorkflowActionIdentifier'] for a in actions)
if args.sleep_probe:
    assert not any(a['WFWorkflowActionIdentifier'].endswith(('downloadurl', 'repeat.each', 'repeat.count', 'health.quantity.log')) for a in actions)
OUT.mkdir(parents=True,exist_ok=True)
out=pathlib.Path('/tmp/OpenGym-sleep-read-probe.unsigned.shortcut') if args.sleep_probe else pathlib.Path('/tmp/OpenGym-serialization-scale.unsigned.shortcut') if args.serialization_smoke else pathlib.Path('/tmp/OpenGym-daily-health-smoke.unsigned.shortcut') if args.smoke else OUT / 'OpenGym-daily-health.unsigned.shortcut'
out.write_bytes(plistlib.dumps(workflow,fmt=plistlib.FMT_BINARY))
print(f'{out}: {len(actions)} actions; action references validated; no credential embedded')
