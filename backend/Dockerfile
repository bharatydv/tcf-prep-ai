FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# server.py binds 0.0.0.0:8000; EXPOSE said 5000 and only worked because
# compose mapped the port explicitly.
EXPOSE 8000
CMD ["python", "server.py"]
