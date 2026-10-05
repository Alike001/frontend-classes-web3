import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatEther, parseEther } from 'ethers';
import { PredictionMarketData, MarketOutcome } from '../types/prediction';
import { useContract } from './useContract';
import { PREDICTION_HUB_ADDRESS, PREDICTION_HUB_ABI } from '../contracts/predictionConfig';


/*export const useWeb3Wallet = () => {
  // TODO FOR ASSIGNMENT:
  // 1. Detect window.ethereum
  // 2. Connect via ethers.BrowserProvider
  // 3. Keep track of address, network chainId, and ETH balance
  
  const wallet: WalletState = {
    address: null,
    chainId: null,
    balance: '0.00',
    isConnected: false,
    isConnecting: false,
    error: null,
  };

  const connectWallet = async () => {
    console.log('Assignment TODO: Connect wallet using ethers BrowserProvider');
  };

  return { wallet, connectWallet };
};*/

export const usePredictionMarket = (walletAddress: string | null) => {
  // TODO FOR ASSIGNMENT:
  // 1. Connect to PredictionMarketOracleHub contract using ethers.Contract
  // 2. Fetch all markets using getAllMarkets()
  // 3. For each market, read calculateWinnings() and userBets() for connected user
  // 4. Implement event listeners for MarketCreated, BetPlaced, MarketResolved, WinningsClaimed
  // 5. Implement placeBet(), claimWinnings(), and createMarket() (Owner mode)
  const { getContract } = useContract();
  const contract = useMemo(
    () => getContract(PREDICTION_HUB_ADDRESS, PREDICTION_HUB_ABI),
    [getContract]
  );
  const signerContract = useMemo(
    () => getContract(PREDICTION_HUB_ADDRESS, PREDICTION_HUB_ABI, true),
    [getContract]
  );

  const [markets, setMarkets] = useState<PredictionMarketData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMarkets = useCallback(async () => {
    if (!contract) {
      throw new Error('Prediction market contract is not available.');
    }

    const onChainMarkets = await contract.getAllMarkets();
    const now = Math.floor(Date.now() / 1000);

    const formattedMarkets: PredictionMarketData[] = await Promise.all(
      onChainMarkets.map(async (market: {
        id: bigint;
        title: string;
        category: string;
        endTime: bigint;
        outcome: bigint;
        totalYesPool: bigint;
        totalNoPool: bigint;
        resolved: boolean;
      }) => {
        let userYesBet = '0';
        let userNoBet = '0';
        let userClaimed = false;
        let userEstimatedWinnings = '0';

        if (walletAddress) {
          const [userBet, winnings] = await Promise.all([
            contract.userBets(market.id, walletAddress),
            contract.calculateWinnings(market.id, walletAddress),
          ]);

          userYesBet = formatEther(userBet.yesAmount);
          userNoBet = formatEther(userBet.noAmount);
          userClaimed = userBet.claimed;
          userEstimatedWinnings = formatEther(winnings);
        }

        return {
          id: Number(market.id),
          title: market.title,
          category: market.category,
          endTime: Number(market.endTime),
          outcome: Number(market.outcome) as MarketOutcome,
          totalYesPool: formatEther(market.totalYesPool),
          totalNoPool: formatEther(market.totalNoPool),
          resolved: market.resolved,
          userYesBet,
          userNoBet,
          userClaimed,
          userEstimatedWinnings,
          isExpired: Number(market.endTime) <= now,
        };
      })
    );

    setMarkets(formattedMarkets);
  }, [contract, walletAddress]);

  useEffect(() => {
    let isCancelled = false;

    const loadMarkets = async () => {
      setIsLoading(true);
      setError(null);

      try {
        await refreshMarkets();
      } catch (fetchError: unknown) {
        if (!isCancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch markets.');
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadMarkets();

    if (!contract) {
      return () => {
        isCancelled = true;
      };
    }

    const handleMarketChange = () => {
      void refreshMarkets().catch((eventError: unknown) => {
        if (!isCancelled) {
          setError(eventError instanceof Error ? eventError.message : 'Failed to refresh markets.');
        }
      });
    };

    contract.on('MarketCreated', handleMarketChange);
    contract.on('BetPlaced', handleMarketChange);
    contract.on('MarketResolved', handleMarketChange);
    contract.on('WinningsClaimed', handleMarketChange);

    return () => {
      isCancelled = true;
      contract.off('MarketCreated', handleMarketChange);
      contract.off('BetPlaced', handleMarketChange);
      contract.off('MarketResolved', handleMarketChange);
      contract.off('WinningsClaimed', handleMarketChange);
    };
  }, [contract, refreshMarkets]);

  const placeBet = async (marketId: number, isYes: boolean, amountEth: string) => {
    if (!signerContract) throw new Error('Connect your wallet before placing a bet.');

    try {
      const transaction = await signerContract.placeBet(marketId, isYes, {
        value: parseEther(amountEth),
      });
      await transaction.wait();
      await refreshMarkets();
    } catch (transactionError: unknown) {
      const message = transactionError instanceof Error ? transactionError.message : 'Failed to place bet.';
      setError(message);
      throw transactionError;
    }
  };

  const claimWinnings = async (marketId: number) => {
    if (!signerContract) throw new Error('Connect your wallet before claiming winnings.');

    try {
      const transaction = await signerContract.claimWinnings(marketId);
      await transaction.wait();
      await refreshMarkets();
    } catch (transactionError: unknown) {
      const message = transactionError instanceof Error ? transactionError.message : 'Failed to claim winnings.';
      setError(message);
      throw transactionError;
    }
  };

  const createMarket = async (title: string, category: string, durationSeconds: number) => {
    if (!signerContract) throw new Error('Connect the owner wallet before creating a market.');
    if (durationSeconds <= 0) throw new Error('Market duration must be greater than zero.');

    try {
      const transaction = await signerContract.createMarket(title, category, durationSeconds);
      await transaction.wait();
      await refreshMarkets();
    } catch (transactionError: unknown) {
      const message = transactionError instanceof Error ? transactionError.message : 'Failed to create market.';
      setError(message);
      throw transactionError;
    }
  };

  return { markets, isLoading, error, placeBet, claimWinnings, createMarket };
};
