from pydantic import BaseModel


class RenameBody(BaseModel):
    new_name: str


class SaveSRTBody(BaseModel):
    name: str
    content: str
