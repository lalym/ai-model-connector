#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=${PORT:-8080}
python manage.py migrate --run-syncdb
python manage.py runserver "0.0.0.0:$PORT"
