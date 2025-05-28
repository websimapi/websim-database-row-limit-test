const App = () => {
    const room = React.useMemo(() => new WebsimSocket(), []);
    const collectionName = 'stress_test_row_v3'; // Use a versioned collection name
    const testRowCollection = React.useMemo(() => room.collection(collectionName), [room, collectionName]);

    const [isRunning, setIsRunning] = React.useState(false);
    const [attemptedCount, setAttemptedCount] = React.useState(0);
    const [currentValue, setCurrentValue] = React.useState(0);
    const [delayMs, setDelayMs] = React.useState(10); // Initial delay
    const [lastError, setLastError] = React.useState(null);
    const [statusMessage, setStatusMessage] = React.useState("Idle. Click 'Start Test' to begin.");
    const [successfulLocalInserts, setSuccessfulLocalInserts] = React.useState(0);

    const timeoutRef = React.useRef(null);

    const subscribeFn = React.useCallback(cb => testRowCollection.subscribe(cb), [testRowCollection]);
    const getListFn = React.useCallback(() => testRowCollection.getList(), [testRowCollection]);
    const dbRows = React.useSyncExternalStore(subscribeFn, getListFn, () => []);
    
    const confirmedCountInDB = dbRows.length;

    const insertRowLogic = React.useCallback(async () => {
        setAttemptedCount(prev => prev + 1);
        const valueToInsert = currentValue;

        try {
            setStatusMessage(`Attempting: Value ${valueToInsert}, Delay: ${delayMs}ms`);
            await testRowCollection.create({ 
                value: valueToInsert, 
                client_timestamp: Date.now() 
            });
            setSuccessfulLocalInserts(prev => prev + 1);
            setCurrentValue(prev => prev + 1);
            setLastError(null);
            // Optional: If things are going well, try to speed up slightly
            // setDelayMs(prev => Math.max(1, Math.floor(prev * 0.95))); // Speed up by 5%, min 1ms
            setStatusMessage(`Success: Value ${valueToInsert}. Next in ${delayMs}ms.`);
        } catch (error) {
            console.error(`Insertion error for value ${valueToInsert}:`, error);
            const errorMessage = error.message || String(error);
            setLastError(`Failed (val: ${valueToInsert}): ${errorMessage.substring(0,100)}`); // Limit error message length
            const newDelay = Math.min(Math.floor(delayMs * 1.5) + 100, 10000); // Slow down: 1.5x + 100ms, cap at 10s
            setDelayMs(newDelay);
            setStatusMessage(`Error: Value ${valueToInsert}. New delay: ${newDelay}ms. Retrying...`);
        }
    }, [currentValue, delayMs, testRowCollection, setAttemptedCount, setSuccessfulLocalInserts, setCurrentValue, setLastError, setDelayMs, setStatusMessage]);

    React.useEffect(() => {
        if (isRunning) {
            const runLoop = async () => {
                if (!isRunningRef.current) return; // Uses a ref to check current status
                await insertRowLogic();
                if (isRunningRef.current) { // Check again after await
                    timeoutRef.current = setTimeout(runLoop, delayMs);
                }
            };
            
            // Use a ref for isRunning to ensure the loop checks the latest state
            // This is because the `runLoop` function's closure captures `isRunning` at the time of its definition (or last `useEffect` run)
            // While `delayMs` change correctly triggers re-schedule, `isRunning` changing to false needs immediate effect.
            const isRunningRef = React.useRef(isRunning);
            isRunningRef.current = isRunning; // Update ref on each render

            // Clear previous timeout before starting a new one to ensure correct delay.
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(runLoop, delayMs); // Start the loop

        } else {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            if (attemptedCount > 0) { // Only update status if test was running
                setStatusMessage("Stopped. Click 'Start Test' to resume or 'Reset' for a new session.");
            } else {
                setStatusMessage("Idle. Click 'Start Test' to begin.");
            }
        }

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            // Ensure ref is updated if component unmounts or isRunning changes.
            isRunningRef.current = false; 
        };
    }, [isRunning, delayMs, insertRowLogic, attemptedCount]); // Add attemptedCount to re-evaluate initial status message.

    const handleStartTest = () => {
        // If not resetting value, it continues. Resetting provides a cleaner test start.
        // setCurrentValue(0); // Optional: reset value for each test run
        setLastError(null);
        setDelayMs(1); // Start fast
        setIsRunning(true);
        setStatusMessage("Test started. Initializing first insert...");
    };

    const handleStopTest = () => {
        setIsRunning(false);
        // Status message updated by useEffect
    };
    
    const handleResetClientState = () => {
        setIsRunning(false); // Stop any ongoing test
        
        setCurrentValue(0);
        setAttemptedCount(0);
        setSuccessfulLocalInserts(0);
        setLastError(null);
        setDelayMs(10); // Reset delay to a moderate default
        setStatusMessage("Client state reset. Database rows shown are current. Ready for a new test.");
    };

    return (
        <div>
            <h1>Database Stress Test</h1>
            <div className="button-group">
                <button onClick={handleStartTest} disabled={isRunning}>Start Test</button>
                <button onClick={handleStopTest} disabled={!isRunning}>Stop Test</button>
                <button onClick={handleResetClientState} disabled={isRunning}>Reset Client State & Counters</button>
            </div>

            <h2>Live Status & Stats</h2>
            <p><strong>Status:</strong> {statusMessage}</p>
            <div className="stats-grid">
                <div className="stat-item"><strong>Test Running:</strong> {isRunning ? "Yes" : "No"}</div>
                <div className="stat-item"><strong>Attempted Inserts:</strong> {attemptedCount}</div>
                <div className="stat-item"><strong>Succeeded (Client Ack):</strong> {successfulLocalInserts}</div>
                <div className="stat-item"><strong>Next Value to Insert:</strong> {currentValue}</div>
                <div className="stat-item"><strong>Current Delay:</strong> {delayMs} ms</div>
                <div className="stat-item"><strong>Collection:</strong> {collectionName}</div>
            </div>
            {lastError && <p className="error-message">Last Error: {lastError}</p>}
            
            <h2>Database Verification</h2>
            <p><strong>Total Confirmed Rows in DB: {confirmedCountInDB}</strong></p>
            <p><em>(Showing up to 5 most recent rows from database. List updates in real-time.)</em></p>
            <ul>
                {dbRows.length === 0 && <li>No rows found in the database for collection '{collectionName}'.</li>}
                {dbRows.slice(0, 5).map(row => (
                    <li key={row.id}>
                        <strong>Value: {row.value}</strong> (ID: {row.id.substring(0,8)}...) <br />
                        Created: {new Date(row.created_at).toLocaleString()} by {row.username} <br />
                        Client Ts: {row.client_timestamp ? new Date(row.client_timestamp).toLocaleTimeString([], {hour12:false, minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3}) : 'N/A'}
                    </li>
                ))}
            </ul>
            {dbRows.length > 5 && <p>...and {dbRows.length - 5} more rows not shown.</p>}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

