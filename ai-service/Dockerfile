FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*
RUN wget -O /usr/local/bin/wait-for-it https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh
RUN chmod +x /usr/local/bin/wait-for-it

COPY requirements.txt .
# scipy and pyarrow are large wheels; the default 15 s socket timeout is not
# enough on a slow link and the build fails halfway through.
RUN pip install --no-cache-dir --timeout 120 --retries 8 -r requirements.txt

COPY . .

# Expose port for FastAPI
EXPOSE 8000

# Start script
CMD ["wait-for-it", "postgis:5432", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
