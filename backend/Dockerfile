FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Root inside a container turns any code-execution bug into an attempt at the
# host. Nothing here needs to write to the image or bind a privileged port, so
# nothing here needs root. Ownership is set on /app so the reloader and any
# temporary file still work if someone runs this stack in development mode.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# server.py binds 0.0.0.0:8000; EXPOSE said 5000 and only worked because
# compose mapped the port explicitly.
EXPOSE 8000
CMD ["python", "server.py"]
