import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
baseline = pathlib.Path(__file__).with_name('local-catalog.json')
expected = json.loads(baseline.read_text())
candidates = []
decoder = json.JSONDecoder()

def collect(value, depth=0):
    if depth > 16:
        return
    if isinstance(value, dict):
        if 'catalog' in value and 'app_role' in value and 'column_privileges' in value:
            candidates.append(value)
            return
        for nested in value.values():
            collect(nested, depth + 1)
    elif isinstance(value, list):
        for nested in value:
            collect(nested, depth + 1)
    elif isinstance(value, str):
        offset = 0
        while offset < len(value):
            starts = [p for p in (value.find('{', offset), value.find('[', offset)) if p >= 0]
            if not starts:
                break
            position = min(starts)
            try:
                parsed, length = decoder.raw_decode(value[position:])
            except ValueError:
                offset = position + 1
                continue
            collect(parsed, depth + 1)
            offset = position + length

collect(source.read_text())
if not candidates:
    raise SystemExit('No hosted verification object found in supplied evidence.')
actual = candidates[-1]
checks = []

def check(name, condition, evidence=None):
    checks.append({'name': name, 'passed': bool(condition), 'evidence': evidence})

for key in expected:
    check('catalog ' + key, actual['catalog'].get(key) == expected[key],
          {'expected_rows': len(expected[key]), 'actual_rows': len(actual['catalog'].get(key, []))})
check('database identity', actual.get('database') == 'postgres', actual.get('database'))
check('schema owner', actual.get('schema_owner') == 'postgres', actual.get('schema_owner'))
role = actual.get('app_role', [])
expected_role = dict(rolname='falcon_mesh_app', rolcanlogin=False, rolsuper=False,
                     rolcreatedb=False, rolcreaterole=False, rolreplication=False,
                     rolbypassrls=False, rolinherit=False)
check('exact app role attributes', role == [expected_role], role)
memberships = actual.get('app_memberships', [])
check('no parent memberships for app', not any(m['member'] == 'falcon_mesh_app' for m in memberships), memberships)
creator = [m for m in memberships if m['granted_role'] == 'falcon_mesh_app']
check('one automatic creator admin membership', len(creator) == 1 and
      creator[0]['member'] == 'postgres' and creator[0]['admin_option'] is True and
      creator[0]['inherit_option'] is False and creator[0]['set_option'] is False, creator)
indices = actual.get('index_status', [])
expected_names = sorted((x['tablename'], x['indexname']) for x in expected['indexes'])
check('index health inventory', sorted((x['tablename'], x['indexname']) for x in indices) == expected_names)
check('all indexes valid ready and live', all(x['indisvalid'] and x['indisready'] and x['indislive'] for x in indices))
unique_names = {x['indexname'] for x in expected['indexes'] if x['indexdef'].startswith('CREATE UNIQUE INDEX')}
check('index uniqueness', all(x['indisunique'] == (x['indexname'] in unique_names) for x in indices))
roles = {'falcon_mesh_app', 'anon', 'authenticated', 'service_role'}
schema_rights = actual.get('schema_privileges', [])
check('schema privilege inventory', len(schema_rights) == 4 and {x['role'] for x in schema_rights} == roles)
check('schema privilege values', all(x['schema_usage'] == (x['role'] == 'falcon_mesh_app') and x['schema_create'] is False for x in schema_rights))
tables = {x['relname'] for x in expected['tables']}
table_rights = actual.get('table_privileges', [])
check('table privilege inventory', len(table_rights) == 20 and
      {(x['role'], x['table_name']) for x in table_rights} == {(r,t) for r in roles for t in tables})
check('only SELECT INSERT table privileges for app', all(
      all(x[p] == (x['role'] == 'falcon_mesh_app') for p in ['select', 'insert']) and
      all(x[p] is False for p in ['update', 'delete', 'truncate', 'references', 'trigger', 'maintain'])
      for x in table_rights))
columns = {(x['relname'], x['attname']) for x in expected['columns']}
column_rights = actual.get('column_privileges', [])
check('column privilege inventory', len(column_rights) == 132 and
      {(x['role'], x['table_name'], x['column_name']) for x in column_rights} ==
      {(r,t,c) for r in roles for t,c in columns})
check('column SELECT INSERT REFERENCES privileges', all(
      all(x[p] == (x['role'] == 'falcon_mesh_app') for p in ['select', 'insert']) and x['references'] is False
      for x in column_rights))
updates = [(x['role'], x['table_name'], x['column_name']) for x in column_rights if x['update']]
check('only head revision column can UPDATE', updates == [('falcon_mesh_app', 'source_heads', 'revision_id')], updates)
database_rights = actual.get('app_database_privileges') or {}
check('app CONNECT without database CREATE', database_rights.get('connect') is True and database_rights.get('create') is False, database_rights)
report = {
    'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'baseline': str(baseline), 'baseline_sha256': hashlib.sha256(baseline.read_bytes()).hexdigest(),
    'server_version': actual.get('server_version'), 'schema_acl': actual.get('schema_acl'),
    'checks': checks, 'passed': sum(x['passed'] for x in checks), 'total': len(checks),
    'blind_spots': ['This compares returned catalog evidence, not a runtime login or TLS connection.',
                   'It checks all listed schema/table/column privileges for four roles, not every database object or every role.']
}
print(json.dumps(report, indent=2))
sys.exit(0 if report['passed'] == report['total'] else 1)
