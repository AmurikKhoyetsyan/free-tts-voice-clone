from pydantic import BaseModel


class RenameBody(BaseModel):
    new_name: str
