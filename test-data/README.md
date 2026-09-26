# Local Docker test data and access

This is disposable test input for the Docker development profile. It contains no real resident information, MAX account IDs, or credentials. The Compose service starts a fresh SQLite database in the `dompulse-data` volume.

Use the login selector in the app:

- `dev-1`, `dev-2`, `dev-3` are three distinct simulated residents.
- `dev-admin` is a simulated administrator for changing statuses.

For a non-sensitive manual report, use the ITMO category `прачечная, 1-й этаж`, issue `Нет холодной воды`, and a brief description such as `Проверка локального Docker-пилота`. Submit once as each of the three resident accounts within 20 minutes. The third creates a “Похожие обращения / возможный общий инцидент” record; change its status with `dev-admin`. This verifies the selected-category grouping flow, not the building's physical layout or a MAX connection.

Equivalent JSON body for a single local-only request (a new UUID is required for each new report):

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "buildingId": "itmo-vyazemsky",
  "zoneId": "laundry",
  "place": "прачечная, 1-й этаж",
  "category": "Нет холодной воды",
  "description": "Проверка локального Docker-пилота"
}
```

The HTTP write endpoints also require the session cookie, matching `Origin`, and `X-DomPulse-Request: 1`. The local app creates those through its development sign-in. The example UUID is illustrative; it is not seeded or automatically submitted.
