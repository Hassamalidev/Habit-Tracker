# Only needed for the container route (Fly.io, Railway, Koyeb, a uni server).
# Render runs this app natively from render.yaml and does not need it.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, so a code change does not reinstall the whole tree.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hosts inject the port; default to 8000 for a plain `docker run`.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
