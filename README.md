# tesla-cloud

## About

JavaScript-based site with information and links intended for use on an in-car browser. Currently focused on Teslas, but could be adapted for other vehicles with a browser.

## Demo

The main branch is generally running at <https://teslas.cloud>.

## Contributing

If you're interested in helping develop this further, contact <feedback@teslas.cloud>.

## Development

Run a local PHP server to exercise the backend APIs:

```bash
php -S localhost:8000
```

The RestDB test script defaults to this address. To run the tests:

```bash
./test/restdb.sh
```

If the endpoint is hosted elsewhere, provide its URL:

```bash
BASE_URL=http://example.com/rest_db.php ./test/restdb.sh
```

