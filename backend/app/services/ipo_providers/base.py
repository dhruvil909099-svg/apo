import abc
from typing import Dict, Any, List, Optional
from datetime import datetime


class BaseIPOProvider(abc.ABC):
    """
    Abstract Base Class for IPO data providers.
    Enforces standardized contract, error isolation, and provenance metadata.
    """

    @abc.abstractmethod
    def get_provider_name(self) -> str:
        """Returns unique system identifier for provider."""
        pass

    @abc.abstractmethod
    def fetch_current_issues(self) -> List[Dict[str, Any]]:
        """
        Fetches currently active / bidding IPO issues.
        Returns standardized dictionary items.
        """
        pass

    @abc.abstractmethod
    def fetch_upcoming_issues(self) -> List[Dict[str, Any]]:
        """
        Fetches announced / forthcoming IPO issues.
        Returns standardized dictionary items.
        """
        pass

    @abc.abstractmethod
    def fetch_issue_details(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetches comprehensive issue metadata (lot size, price band, registrar, documents).
        """
        pass
