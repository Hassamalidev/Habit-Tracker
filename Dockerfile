# Builds the API. It lives at the repo root because that is where Render, Fly,
# Railway and Koyeb all look by default; the build context is the whole repo, so
# the paths below reach into backend/ explicitly.
#
# The frontend is not built here — it deploys to Vercel as static files.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, so editing application code does not reinstall the tree.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Hosts inject the port; 8000 is only the default for a plain `docker run`.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
