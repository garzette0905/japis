# migrations/

이미 운영 중인 D1에 표·컬럼을 더하는 스크립트를 둡니다. 한 번씩만 실행합니다.

```bash
npx wrangler d1 execute japis-db --remote --file=./migrations/00X_....sql
```

`schema.sql` 의 `CREATE TABLE IF NOT EXISTS` 는 표가 이미 있으면 통째로 건너뛰므로,
**나중에 더한 컬럼은 schema.sql 을 다시 돌려도 생기지 않습니다.** SQLite에는
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 가 없어서, 재실행하면 "duplicate column"
오류로 멈춥니다 → 그래서 별도 파일로 나눕니다.

> ⚠️ 새 파일을 만들었다면 **push하기 전에** 운영 D1에 먼저 적용하세요.
> 새 코드가 읽을 표가 배포 시점에 이미 있어야 합니다.

지금은 비어 있습니다 (schema.sql 이 최초 스키마 전부).
