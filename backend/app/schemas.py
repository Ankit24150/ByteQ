from typing import Literal

from pydantic import BaseModel, Field, field_validator

STATUSES = ["Pending", "Accepted", "Preparing", "Ready for Pickup", "Completed", "Cancelled"]
Status = Literal["Pending", "Accepted", "Preparing", "Ready for Pickup", "Completed", "Cancelled"]


class OrderItemIn(BaseModel):
    menu_item_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=10, description="1-10 per item")


class OrderIn(BaseModel):
    customer_name: str = Field(min_length=2, max_length=60)
    slot_id: int = Field(gt=0)
    items: list[OrderItemIn] = Field(min_length=1, max_length=20)
    payment_method: Literal["cash_on_pickup", "simulated_upi", "simulated_card"] = "cash_on_pickup"

    @field_validator("customer_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("customer_name must be at least 2 characters")
        return v


class StatusIn(BaseModel):
    status: Status


class MenuPatch(BaseModel):
    availability: bool | None = None
    price: int | None = Field(default=None, gt=0, le=2000)


class SlotPatch(BaseModel):
    capacity: int = Field(ge=1, le=200)
