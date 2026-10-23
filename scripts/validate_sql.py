import pathlib, sqlite3
root=pathlib.Path(__file__).resolve().parents[1]
c=sqlite3.connect(':memory:')
for f in sorted((root/'migrations').glob('*.sql')):c.executescript(f.read_text())
for table in ('patients','tasks','appointments','messages','jobs','activity','backup_snapshots','requirement_catalog','bot_updates'):
    assert c.execute("select count(*) from sqlite_master where name=?",(table,)).fetchone()[0] == 1,table
print('SQL migration integrity OK')
