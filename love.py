import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

uri = os.getenv("MONGODB_URI")
client = MongoClient(uri)

for db_name in client.list_database_names():
    if db_name not in ("admin", "local", "config"):
        client.drop_database(db_name)
        print(f"Deleted: {db_name}")

client.close()