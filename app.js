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
    const isRunningRef = React.useRef(isRunning); // Initialize with the current (initial) isRunning state

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
            setStatusMessage(`Success: Value ${valueToInsert}. Next in ${delayMs}ms.`);
        } catch (error) {
            console.error(`Insertion error for value ${valueToInsert}:`, error);
            const errorMessage = error.message || String(error);
            setLastError(`Failed (val: ${valueToInsert}): ${errorMessage.substring(0,100)}`);
            const newDelay = Math.min(Math.floor(delayMs * 1.5) + 100, 10000);
            setDelayMs(newDelay);
            setStatusMessage(`Error: Value ${valueToInsert}. New delay: ${newDelay}ms. Retrying...`);
        }
    }, [currentValue, delayMs, testRowCollection, setAttemptedCount, setSuccessfulLocalInserts, setCurrentValue, setLastError, setDelayMs, setStatusMessage]);

    React.useEffect(() => {
        // Always update the ref's current value to the latest isRunning state.
        isRunningRef.current = isRunning;

        if (isRunning) {
            const runLoop = async () => {
                if (!isRunningRef.current) return; // Check ref before async operation
                await insertRowLogic();
                if (isRunningRef.current) { // Check ref again after async operation
                    timeoutRef.current = setTimeout(runLoop, delayMs);
                }
            };
            
            // Removed the local `const isRunningRef = React.useRef(isRunning);` and
            // `isRunningRef.current = isRunning;` from here as it's now handled
            // at the component scope and updated at the start of this effect.

            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(runLoop, delayMs);

        } else {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            if (attemptedCount > 0) {
                setStatusMessage("Stopped. Click 'Start Test' to resume or 'Reset' for a new session.");
            } else {
                setStatusMessage("Idle. Click 'Start Test' to begin.");
            }
        }

        return () => { // Cleanup function
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            // This line now correctly refers to the component-scoped isRunningRef.
            // Setting it to false on cleanup is a safeguard to signal any
            // ongoing async operations (post-await) to stop.
            isRunningRef.current = false; 
        };
    }, [isRunning, delayMs, insertRowLogic, attemptedCount]);

    const handleStartTest = () => {
        setLastError(null);
        setDelayMs(1); 
        setIsRunning(true);
        setStatusMessage("Test started. Initializing first insert...");
    };

    const handleStopTest = () => {
        setIsRunning(false);
    };
    
    const handleResetClientState = () => {
        setIsRunning(false); 
        setCurrentValue(0);
        setAttemptedCount(0);
        setSuccessfulLocalInserts(0);
        setLastError(null);
        setDelayMs(10); 
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