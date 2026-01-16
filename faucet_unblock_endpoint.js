// Unblock Faucet Endpoint - Send self-transaction with boosted gas to clear stuck nonce
app.post('/api/faucet/unblock', async (req, res) => {
    try {
        const { funderAddress } = req.body;

        if (!funderAddress) {
            return res.status(401).json({ success: false, error: 'Funder address required' });
        }

        console.log(`[Faucet Unblock] 🔧 Starting unblock for: ${funderAddress}`);

        // Get blockchain provider
        const provider = globalRpcManager.getProvider();

        // Get faucet wallet
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, funderAddress);
        console.log(`[Faucet Unblock] 🔑 Using Faucet Wallet: ${faucetWallet.address}`);

        // Check nonce status
        const [latestNonce, pendingNonce, balance] = await Promise.all([
            provider.getTransactionCount(faucetWallet.address, 'latest'),
            provider.getTransactionCount(faucetWallet.address, 'pending'),
            provider.getBalance(faucetWallet.address)
        ]);

        console.log(`[Faucet Unblock] 📊 Nonce Status: Latest=${latestNonce}, Pending=${pendingNonce}`);
        console.log(`[Faucet Unblock] 💰 Balance: ${ethers.formatEther(balance)} POL`);

        if (pendingNonce === latestNonce) {
            return res.json({
                success: true,
                message: 'Faucet is not blocked',
                latestNonce,
                pendingNonce
            });
        }

        const diff = pendingNonce - latestNonce;
        console.log(`[Faucet Unblock] ⚠️  Faucet BLOQUEADO! ${diff} transacciones pendientes`);

        // Check balance
        const minBalance = ethers.parseEther('0.01');
        if (balance < minBalance) {
            return res.status(400).json({
                success: false,
                error: `Balance insuficiente: ${ethers.formatEther(balance)} POL. Necesita al menos 0.01 POL`
            });
        }

        // Get fee data and boost 3x for unblock
        const feeData = await provider.getFeeData();
        const boostGasPrice = (feeData.gasPrice * 30n) / 10n; // 3x gas price

        console.log(`[Faucet Unblock] ⛽ Gas Price (3x boost): ${ethers.formatUnits(boostGasPrice, 'gwei')} gwei`);

        // Send self-transaction to unblock
        const tx = {
            to: faucetWallet.address, // Self-transaction
            value: 0,
            nonce: latestNonce,
            gasLimit: 30000,
            gasPrice: boostGasPrice
        };

        console.log(`[Faucet Unblock] 🚀 Sending unblock transaction (Nonce: ${latestNonce})...`);
        const txResponse = await faucetWallet.sendTransaction(tx);

        console.log(`[Faucet Unblock] 📤 TX Hash: ${txResponse.hash}`);

        // Wait for confirmation with timeout
        const receipt = await Promise.race([
            txResponse.wait(1),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 120000))
        ]);

        // Verify new nonce status
        const [newLatest, newPending] = await Promise.all([
            provider.getTransactionCount(faucetWallet.address, 'latest'),
            provider.getTransactionCount(faucetWallet.address, 'pending')
        ]);

        const isUnblocked = newLatest === newPending;

        console.log(`[Faucet Unblock] ${isUnblocked ? '✅ DESBLOQUEADO' : '⚠️  AÚN BLOQUEADO'}`);
        console.log(`[Faucet Unblock] New Nonces: Latest=${newLatest}, Pending=${newPending}`);

        res.json({
            success: true,
            txHash: txResponse.hash,
            explorerUrl: `https://polygonscan.com/tx/${txResponse.hash}`,
            gasUsed: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
            isUnblocked,
            oldNonce: latestNonce,
            newNonce: newLatest,
            message: isUnblocked ? 'Faucet desbloqueado exitosamente' : `Aún quedan ${newPending - newLatest} transacciones pendientes`
        });

    } catch (error) {
        console.error('[Faucet Unblock] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.code || 'UNKNOWN_ERROR'
        });
    }
});
